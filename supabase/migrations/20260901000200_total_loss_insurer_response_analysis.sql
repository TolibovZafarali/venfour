-- Add durable, owner-safe insurer-response analysis without changing the
-- authoritative valuation, report, commerce, entitlement, or negotiation
-- action domains. The immutable inbound communication remains the source;
-- analysis and document extraction are derived, private records.

create table public.total_loss_insurer_response_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  negotiation_round_id uuid not null,
  response_communication_id uuid not null,
  source_document_id uuid,
  source_report_version_id uuid not null,
  source_message_version_id uuid not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  processing_token uuid,
  processing_expires_at timestamptz,
  current_run_id uuid,
  next_attempt_at timestamptz not null default statement_timestamp(),
  failure_code text,
  retryable boolean,
  completed_at timestamptz,
  failed_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_response_analysis_jobs_id_case_key
    unique (id, case_id),
  constraint total_loss_response_analysis_jobs_response_key
    unique (response_communication_id),
  constraint total_loss_response_analysis_jobs_round_case_fkey
    foreign key (negotiation_round_id, case_id)
    references public.total_loss_negotiation_rounds (id, case_id)
    on delete restrict,
  constraint total_loss_response_analysis_jobs_response_case_fkey
    foreign key (response_communication_id, case_id)
    references public.total_loss_communications (id, case_id)
    on delete restrict,
  constraint total_loss_response_analysis_jobs_document_case_fkey
    foreign key (source_document_id, case_id)
    references public.total_loss_claim_documents (id, case_id)
    on delete restrict,
  constraint total_loss_response_analysis_jobs_report_case_fkey
    foreign key (source_report_version_id, case_id)
    references public.total_loss_report_versions (id, case_id)
    on delete restrict,
  constraint total_loss_response_analysis_jobs_message_case_fkey
    foreign key (source_message_version_id, case_id)
    references public.total_loss_message_versions (id, case_id)
    on delete restrict,
  constraint total_loss_response_analysis_jobs_status_valid
    check (status in (
      'pending',
      'processing',
      'completed',
      'retryable_failed',
      'terminal_failed',
      'unsupported',
      'superseded'
    )),
  constraint total_loss_response_analysis_jobs_attempt_valid
    check (attempt_count >= 0),
  constraint total_loss_response_analysis_jobs_failure_code_safe
    check (
      failure_code is null
      or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
  constraint total_loss_response_analysis_jobs_state_complete
    check (
      (
        status = 'pending'
        and processing_token is null
        and processing_expires_at is null
        and failure_code is null
        and retryable is null
        and completed_at is null
        and failed_at is null
        and superseded_at is null
      )
      or (
        status = 'processing'
        and attempt_count >= 1
        and processing_token is not null
        and processing_expires_at is not null
        and failure_code is null
        and retryable is null
        and completed_at is null
        and failed_at is null
        and superseded_at is null
      )
      or (
        status = 'completed'
        and attempt_count >= 1
        and processing_token is not null
        and processing_expires_at is null
        and current_run_id is not null
        and failure_code is null
        and retryable is null
        and completed_at is not null
        and failed_at is null
        and superseded_at is null
      )
      or (
        status = 'retryable_failed'
        and attempt_count >= 1
        and processing_token is not null
        and processing_expires_at is null
        and current_run_id is not null
        and failure_code is not null
        and retryable = true
        and completed_at is null
        and failed_at is not null
        and superseded_at is null
      )
      or (
        status in ('terminal_failed', 'unsupported')
        and attempt_count >= 1
        and processing_token is not null
        and processing_expires_at is null
        and current_run_id is not null
        and failure_code is not null
        and retryable = false
        and completed_at is null
        and failed_at is not null
        and superseded_at is null
      )
      or (
        status = 'superseded'
        and processing_expires_at is null
        and superseded_at is not null
      )
    )
);

comment on table public.total_loss_insurer_response_analysis_jobs is
  'Private durable lifecycle for one immutable insurer response; exactly one job is created for each response version.';
comment on column public.total_loss_insurer_response_analysis_jobs.processing_token is
  'Opaque service-worker lease token that is never included in customer projections.';

create index total_loss_response_analysis_jobs_due_idx
  on public.total_loss_insurer_response_analysis_jobs (
    status,
    next_attempt_at,
    processing_expires_at,
    created_at
  );
create index total_loss_response_analysis_jobs_case_created_idx
  on public.total_loss_insurer_response_analysis_jobs (case_id, created_at desc);

create trigger total_loss_response_analysis_jobs_set_updated_at
before update on public.total_loss_insurer_response_analysis_jobs
for each row execute function public.set_updated_at();

create table public.total_loss_insurer_response_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  job_id uuid not null,
  attempt_number integer not null,
  provider_identifier text not null,
  model_identifier text not null,
  returned_model_identifier text,
  prompt_version text not null,
  schema_version text not null,
  context_version text not null,
  input_digest text,
  output_digest text,
  status text not null default 'processing',
  usage_metadata jsonb,
  failure_code text,
  started_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_response_analysis_runs_id_case_key
    unique (id, case_id),
  constraint total_loss_response_analysis_runs_id_job_case_key
    unique (id, job_id, case_id),
  constraint total_loss_response_analysis_runs_job_attempt_key
    unique (job_id, attempt_number),
  constraint total_loss_response_analysis_runs_job_case_fkey
    foreign key (job_id, case_id)
    references public.total_loss_insurer_response_analysis_jobs (id, case_id)
    on delete restrict,
  constraint total_loss_response_analysis_runs_attempt_valid
    check (attempt_number >= 1),
  constraint total_loss_response_analysis_runs_identifiers_safe
    check (
      provider_identifier ~ '^[a-z][a-z0-9_-]{0,63}$'
      and char_length(model_identifier) between 1 and 255
      and model_identifier !~ '[[:cntrl:]]'
      and (
        returned_model_identifier is null
        or (
          char_length(returned_model_identifier) between 1 and 255
          and returned_model_identifier !~ '[[:cntrl:]]'
        )
      )
      and prompt_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and schema_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and context_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    ),
  constraint total_loss_response_analysis_runs_digests_valid
    check (
      (input_digest is null or input_digest ~ '^[0-9a-f]{64}$')
      and (output_digest is null or output_digest ~ '^[0-9a-f]{64}$')
    ),
  constraint total_loss_response_analysis_runs_status_valid
    check (status in (
      'processing',
      'completed',
      'retryable_failed',
      'terminal_failed',
      'unsupported',
      'superseded'
    )),
  constraint total_loss_response_analysis_runs_usage_object
    check (
      usage_metadata is null
      or (
        jsonb_typeof(usage_metadata) = 'object'
        and pg_column_size(usage_metadata) <= 65536
      )
    ),
  constraint total_loss_response_analysis_runs_failure_code_safe
    check (
      failure_code is null
      or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
  constraint total_loss_response_analysis_runs_state_complete
    check (
      (
        status = 'processing'
        and returned_model_identifier is null
        and input_digest is null
        and output_digest is null
        and failure_code is null
        and completed_at is null
      )
      or (
        status = 'completed'
        and returned_model_identifier is not null
        and input_digest is not null
        and output_digest is not null
        and failure_code is null
        and completed_at is not null
      )
      or (
        status in ('retryable_failed', 'terminal_failed', 'unsupported')
        and output_digest is null
        and failure_code is not null
        and completed_at is not null
      )
      or (
        status = 'superseded'
        and output_digest is null
        and completed_at is not null
      )
    )
);

comment on table public.total_loss_insurer_response_analysis_runs is
  'Private per-attempt provider audit metadata; provider configuration and usage never appear in customer projections.';

create index total_loss_response_analysis_runs_job_created_idx
  on public.total_loss_insurer_response_analysis_runs (job_id, created_at desc);

create trigger total_loss_response_analysis_runs_set_updated_at
before update on public.total_loss_insurer_response_analysis_runs
for each row execute function public.set_updated_at();

alter table public.total_loss_insurer_response_analysis_jobs
add constraint total_loss_response_analysis_jobs_current_run_fkey
foreign key (current_run_id, id, case_id)
references public.total_loss_insurer_response_analysis_runs (id, job_id, case_id)
on delete restrict
deferrable initially deferred;

create table public.total_loss_insurer_response_document_extractions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  document_id uuid not null,
  extraction_version text not null,
  source_content_digest text not null,
  verified_content_digest text not null,
  extraction jsonb not null,
  extraction_digest text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint total_loss_response_extractions_id_case_key unique (id, case_id),
  constraint total_loss_response_extractions_document_version_key
    unique (document_id, extraction_version),
  constraint total_loss_response_extractions_document_case_fkey
    foreign key (document_id, case_id)
    references public.total_loss_claim_documents (id, case_id)
    on delete restrict,
  constraint total_loss_response_extractions_version_safe
    check (extraction_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  constraint total_loss_response_extractions_digests_valid
    check (
      source_content_digest ~ '^[0-9a-f]{64}$'
      and verified_content_digest ~ '^[0-9a-f]{64}$'
      and extraction_digest ~ '^[0-9a-f]{64}$'
      and source_content_digest = verified_content_digest
    ),
  constraint total_loss_response_extractions_payload_valid
    check (
      jsonb_typeof(extraction) = 'object'
      and pg_column_size(extraction) <= 1048576
    )
);

comment on table public.total_loss_insurer_response_document_extractions is
  'Immutable derived text/passages for one verified response document and extractor version; the original private object remains authoritative.';

create index total_loss_response_extractions_case_created_idx
  on public.total_loss_insurer_response_document_extractions (case_id, created_at desc);

create function public.total_loss_response_analysis_evidence_index_is_valid(
  requested_evidence_index jsonb,
  requested_result jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  with response_evidence as (
    select item.value
    from pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof($1 -> 'responseEvidence') = 'array'
          then $1 -> 'responseEvidence'
        else '[]'::jsonb
      end
    ) as item(value)
  ),
  case_evidence as (
    select item.value
    from pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof($1 -> 'caseEvidence') = 'array'
          then $1 -> 'caseEvidence'
        else '[]'::jsonb
      end
    ) as item(value)
  )
  select
    pg_catalog.jsonb_typeof($1) = 'object'
    and pg_catalog.pg_column_size($1) <= 1048576
    and $1 ?& array['responseEvidence', 'caseEvidence']
    and (
      select count(*) = 2
      from pg_catalog.jsonb_object_keys($1)
    )
    and pg_catalog.jsonb_typeof($1 -> 'responseEvidence') = 'array'
    and pg_catalog.jsonb_array_length($1 -> 'responseEvidence') <= 250
    and not exists (
      select 1
      from response_evidence as evidence
      where pg_catalog.jsonb_typeof(evidence.value) <> 'object'
        or not evidence.value ?& array[
          'evidenceRef', 'sourceType', 'content', 'pageNumber'
        ]
        or (
          select count(*) <> 4
          from pg_catalog.jsonb_object_keys(evidence.value)
        )
        or pg_catalog.jsonb_typeof(evidence.value -> 'evidenceRef') <> 'string'
        or evidence.value ->> 'evidenceRef' !~ '^response_[0-9a-f]{64}$'
        or pg_catalog.jsonb_typeof(evidence.value -> 'sourceType') <> 'string'
        or evidence.value ->> 'sourceType' not in (
          'PASTED_TEXT',
          'DOCUMENT',
          'DOCUMENT_TEXT',
          'DOCUMENT_IMAGE',
          'CUSTOMER_SUPPLIED_OFFER'
        )
        or case
          when evidence.value ->> 'sourceType' in ('PASTED_TEXT', 'DOCUMENT_TEXT')
            then pg_catalog.jsonb_typeof(evidence.value -> 'content') <> 'string'
              or char_length(evidence.value ->> 'content') not between 1 and 4000
          else evidence.value -> 'content' <> 'null'::jsonb
        end
        or case
          when evidence.value ->> 'sourceType' = 'DOCUMENT_TEXT'
            then pg_catalog.jsonb_typeof(evidence.value -> 'pageNumber') <> 'number'
              or evidence.value ->> 'pageNumber' !~ '^[1-9][0-9]*$'
              or (evidence.value ->> 'pageNumber')::numeric > 100
          else evidence.value -> 'pageNumber' <> 'null'::jsonb
        end
    )
    and (
      select count(*) = count(distinct evidence.value ->> 'evidenceRef')
      from response_evidence as evidence
    )
    and pg_catalog.jsonb_typeof($1 -> 'caseEvidence') = 'array'
    and pg_catalog.jsonb_array_length($1 -> 'caseEvidence') <= 500
    and not exists (
      select 1
      from case_evidence as evidence
      where pg_catalog.jsonb_typeof(evidence.value) <> 'object'
        or not evidence.value ?& array[
          'evidenceRef', 'evidenceType', 'summary',
          'amountMinorUnits', 'currency'
        ]
        or (
          select count(*) <> 5
          from pg_catalog.jsonb_object_keys(evidence.value)
        )
        or pg_catalog.jsonb_typeof(evidence.value -> 'evidenceRef') <> 'string'
        or evidence.value ->> 'evidenceRef' !~ '^case_[0-9a-f]{64}$'
        or pg_catalog.jsonb_typeof(evidence.value -> 'evidenceType') <> 'string'
        or evidence.value ->> 'evidenceType' not in (
          'INSURER_VALUATION',
          'VENFOUR_FINDING',
          'VENFOUR_COMPARABLE',
          'CUSTOMER_REQUEST',
          'OTHER'
        )
        or pg_catalog.jsonb_typeof(evidence.value -> 'summary') <> 'string'
        or char_length(evidence.value ->> 'summary') not between 1 and 2000
        or case
          when evidence.value -> 'amountMinorUnits' = 'null'::jsonb
            then evidence.value -> 'currency' <> 'null'::jsonb
          when pg_catalog.jsonb_typeof(evidence.value -> 'amountMinorUnits') = 'number'
            then evidence.value ->> 'amountMinorUnits' !~ '^(0|[1-9][0-9]*)$'
              or (evidence.value ->> 'amountMinorUnits')::numeric > 1000000000000
              or pg_catalog.jsonb_typeof(evidence.value -> 'currency') <> 'string'
              or evidence.value ->> 'currency' !~ '^[A-Z]{3}$'
          else true
        end
    )
    and (
      select count(*) = count(distinct evidence.value ->> 'evidenceRef')
      from case_evidence as evidence
    )
    and not exists (
      select 1
      from pg_catalog.jsonb_path_query(
        $2,
        'lax $.**.responseEvidenceRefs[*]'::pg_catalog.jsonpath
      ) as cited(reference)
      where pg_catalog.jsonb_typeof(cited.reference) <> 'string'
        or not exists (
          select 1
          from response_evidence as evidence
          where evidence.value ->> 'evidenceRef' = cited.reference #>> '{}'
        )
    )
    and not exists (
      select 1
      from pg_catalog.jsonb_path_query(
        $2,
        'lax $.**.caseEvidenceRefs[*]'::pg_catalog.jsonpath
      ) as cited(reference)
      where pg_catalog.jsonb_typeof(cited.reference) <> 'string'
        or not exists (
          select 1
          from case_evidence as evidence
          where evidence.value ->> 'evidenceRef' = cited.reference #>> '{}'
        )
    );
$$;

comment on function public.total_loss_response_analysis_evidence_index_is_valid(jsonb, jsonb) is
  'Validates the exact server-built customer-safe evidence projection and binds every structured-result citation to it.';

revoke execute on function public.total_loss_response_analysis_evidence_index_is_valid(jsonb, jsonb)
  from public, anon, authenticated, service_role;

create table public.total_loss_insurer_response_analysis_results (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  job_id uuid not null,
  run_id uuid not null,
  response_communication_id uuid not null,
  schema_version text not null,
  input_digest text not null,
  result jsonb not null,
  result_digest text not null,
  evidence_index jsonb not null,
  evidence_index_digest text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint total_loss_response_analysis_results_id_case_key unique (id, case_id),
  constraint total_loss_response_analysis_results_job_key unique (job_id),
  constraint total_loss_response_analysis_results_run_key unique (run_id),
  constraint total_loss_response_analysis_results_job_run_case_fkey
    foreign key (run_id, job_id, case_id)
    references public.total_loss_insurer_response_analysis_runs (id, job_id, case_id)
    on delete restrict,
  constraint total_loss_response_analysis_results_response_case_fkey
    foreign key (response_communication_id, case_id)
    references public.total_loss_communications (id, case_id)
    on delete restrict,
  constraint total_loss_response_analysis_results_schema_safe
    check (schema_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  constraint total_loss_response_analysis_results_digests_valid
    check (
      input_digest ~ '^[0-9a-f]{64}$'
      and result_digest ~ '^[0-9a-f]{64}$'
      and evidence_index_digest ~ '^[0-9a-f]{64}$'
      and result_digest = public.total_loss_canonical_jsonb_digest(result)
      and evidence_index_digest =
        public.total_loss_canonical_jsonb_digest(evidence_index)
    ),
  constraint total_loss_response_analysis_results_payload_valid
    check (
      jsonb_typeof(result) = 'object'
      and pg_column_size(result) <= 524288
      and public.total_loss_response_analysis_evidence_index_is_valid(
        evidence_index,
        result
      )
    )
);

comment on table public.total_loss_insurer_response_analysis_results is
  'Immutable, strict-schema insurer-response interpretation. It explains existing evidence and has no authority to change valuation or workflow actions.';

create index total_loss_response_analysis_results_case_created_idx
  on public.total_loss_insurer_response_analysis_results (case_id, created_at desc);

create function public.protect_total_loss_response_analysis_job()
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
  then
    raise exception using errcode = '55000', message = 'Terminal insurer-response analysis jobs are immutable.';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_total_loss_response_analysis_job()
  from public, anon, authenticated, service_role;

create trigger total_loss_response_analysis_jobs_protect_history
before update or delete on public.total_loss_insurer_response_analysis_jobs
for each row execute function public.protect_total_loss_response_analysis_job();

create function public.protect_total_loss_response_analysis_run()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'Insurer-response analysis runs cannot be deleted.';
  end if;

  if row(
    new.id, new.case_id, new.job_id, new.attempt_number,
    new.provider_identifier, new.model_identifier, new.prompt_version,
    new.schema_version, new.context_version, new.started_at, new.created_at
  ) is distinct from row(
    old.id, old.case_id, old.job_id, old.attempt_number,
    old.provider_identifier, old.model_identifier, old.prompt_version,
    old.schema_version, old.context_version, old.started_at, old.created_at
  ) then
    raise exception using errcode = '55000', message = 'Insurer-response analysis run identity is immutable.';
  end if;

  if old.status <> 'processing' then
    raise exception using errcode = '55000', message = 'Terminal insurer-response analysis runs are immutable.';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_total_loss_response_analysis_run()
  from public, anon, authenticated, service_role;

create trigger total_loss_response_analysis_runs_protect_history
before update or delete on public.total_loss_insurer_response_analysis_runs
for each row execute function public.protect_total_loss_response_analysis_run();

create trigger total_loss_response_extractions_reject_mutation
before update or delete on public.total_loss_insurer_response_document_extractions
for each row execute function public.reject_total_loss_immutable_record();

create trigger total_loss_response_analysis_results_reject_mutation
before update or delete on public.total_loss_insurer_response_analysis_results
for each row execute function public.reject_total_loss_immutable_record();

alter table public.total_loss_claim_workflows
add column current_response_analysis_job_id uuid,
add constraint total_loss_claim_workflows_current_response_analysis_fkey
foreign key (current_response_analysis_job_id, case_id)
references public.total_loss_insurer_response_analysis_jobs (id, case_id)
on delete restrict
deferrable initially deferred;

comment on column public.total_loss_claim_workflows.current_response_analysis_job_id is
  'Current immutable insurer-response version analysis; stale jobs remain auditable but cannot advance the customer journey.';

create function public.total_loss_enqueue_response_analysis_on_workflow_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  response_row public.total_loss_communications%rowtype;
  origin_row public.total_loss_communications%rowtype;
  document_id uuid;
  job_row public.total_loss_insurer_response_analysis_jobs%rowtype;
begin
  if new.current_task <> 'insurer_response_received'
    or new.current_negotiation_round_id is null
    or new.current_report_version_id is null
  then
    return new;
  end if;

  select communication.* into response_row
  from public.total_loss_communications as communication
  where communication.case_id = new.case_id
    and communication.negotiation_round_id = new.current_negotiation_round_id
    and communication.direction = 'inbound'
    and communication.communication_type = 'insurer_response'
    and communication.status = 'confirmed'
    and not exists (
      select 1
      from public.total_loss_communications as successor
      where successor.case_id = communication.case_id
        and successor.supersedes_communication_id = communication.id
        and successor.direction = 'inbound'
        and successor.communication_type = 'insurer_response'
        and successor.status = 'confirmed'
    )
  order by communication.occurred_at desc, communication.id desc
  limit 1;

  if not found then
    return new;
  end if;

  if old.current_response_analysis_job_id is not null then
    select * into job_row
    from public.total_loss_insurer_response_analysis_jobs as job
    where job.id = old.current_response_analysis_job_id
      and job.case_id = new.case_id;
    if found and job_row.response_communication_id = response_row.id then
      new.current_response_analysis_job_id := job_row.id;
      return new;
    end if;
  end if;

  select communication.* into origin_row
  from public.total_loss_negotiation_rounds as negotiation_round
  join public.total_loss_communications as communication
    on communication.id = negotiation_round.originating_communication_id
    and communication.case_id = negotiation_round.case_id
  where negotiation_round.id = new.current_negotiation_round_id
    and negotiation_round.case_id = new.case_id
    and communication.direction = 'outbound'
    and communication.status = 'confirmed';

  if not found or origin_row.message_version_id is null then
    raise exception using
      errcode = '55000',
      message = 'The sent request source is unavailable for response analysis.';
  end if;

  select communication_document.document_id into document_id
  from public.total_loss_communication_documents as communication_document
  join public.total_loss_claim_documents as document
    on document.id = communication_document.document_id
    and document.case_id = communication_document.case_id
  where communication_document.case_id = new.case_id
    and communication_document.communication_id = response_row.id
    and document.document_kind = 'insurer_response'
    and document.status = 'ready'
  order by communication_document.display_order, document.id
  limit 1;

  if old.current_response_analysis_job_id is not null then
    update public.total_loss_insurer_response_analysis_runs as run
    set status = 'superseded', completed_at = statement_timestamp()
    where run.id = (
      select job.current_run_id
      from public.total_loss_insurer_response_analysis_jobs as job
      where job.id = old.current_response_analysis_job_id
        and job.case_id = new.case_id
    )
      and run.status = 'processing';

    update public.total_loss_insurer_response_analysis_jobs as job
    set status = 'superseded',
        processing_expires_at = null,
        superseded_at = statement_timestamp()
    where job.id = old.current_response_analysis_job_id
      and job.case_id = new.case_id
      and job.status <> 'superseded';
  end if;

  insert into public.total_loss_insurer_response_analysis_jobs (
    case_id,
    negotiation_round_id,
    response_communication_id,
    source_document_id,
    source_report_version_id,
    source_message_version_id,
    status
  ) values (
    new.case_id,
    new.current_negotiation_round_id,
    response_row.id,
    document_id,
    new.current_report_version_id,
    origin_row.message_version_id,
    'pending'
  )
  on conflict on constraint total_loss_response_analysis_jobs_response_key
  do nothing;

  select * into job_row
  from public.total_loss_insurer_response_analysis_jobs as job
  where job.response_communication_id = response_row.id;

  if not found
    or job_row.case_id <> new.case_id
    or job_row.negotiation_round_id <> new.current_negotiation_round_id
    or job_row.source_report_version_id <> new.current_report_version_id
    or job_row.source_message_version_id <> origin_row.message_version_id
    or job_row.source_document_id is distinct from document_id
  then
    raise exception using
      errcode = '55000',
      message = 'Insurer-response analysis lineage conflicts with the current workflow.';
  end if;

  new.current_response_analysis_job_id := job_row.id;
  return new;
end;
$$;

comment on function public.total_loss_enqueue_response_analysis_on_workflow_update() is
  'Atomically creates exactly one pending analysis job when insurer-response intake updates the authoritative workflow; corrections supersede only the prior job.';

revoke execute on function public.total_loss_enqueue_response_analysis_on_workflow_update()
  from public, anon, authenticated, service_role;

-- Backfill any response that was recorded before this migration. The trigger is
-- installed afterward so the pointer update cannot recursively enqueue work.
insert into public.total_loss_insurer_response_analysis_jobs (
  case_id,
  negotiation_round_id,
  response_communication_id,
  source_document_id,
  source_report_version_id,
  source_message_version_id,
  status
)
select
  workflow.case_id,
  workflow.current_negotiation_round_id,
  response.id,
  response_document.document_id,
  workflow.current_report_version_id,
  origin.message_version_id,
  'pending'
from public.total_loss_claim_workflows as workflow
join public.total_loss_negotiation_rounds as negotiation_round
  on negotiation_round.id = workflow.current_negotiation_round_id
  and negotiation_round.case_id = workflow.case_id
join public.total_loss_communications as origin
  on origin.id = negotiation_round.originating_communication_id
  and origin.case_id = negotiation_round.case_id
join lateral (
  select communication.id
  from public.total_loss_communications as communication
  where communication.case_id = workflow.case_id
    and communication.negotiation_round_id = workflow.current_negotiation_round_id
    and communication.direction = 'inbound'
    and communication.communication_type = 'insurer_response'
    and communication.status = 'confirmed'
    and not exists (
      select 1 from public.total_loss_communications as successor
      where successor.case_id = communication.case_id
        and successor.supersedes_communication_id = communication.id
        and successor.direction = 'inbound'
        and successor.communication_type = 'insurer_response'
        and successor.status = 'confirmed'
    )
  order by communication.occurred_at desc, communication.id desc
  limit 1
) as response on true
left join lateral (
  select communication_document.document_id
  from public.total_loss_communication_documents as communication_document
  join public.total_loss_claim_documents as document
    on document.id = communication_document.document_id
    and document.case_id = communication_document.case_id
  where communication_document.case_id = workflow.case_id
    and communication_document.communication_id = response.id
    and document.document_kind = 'insurer_response'
    and document.status = 'ready'
  order by communication_document.display_order, communication_document.document_id
  limit 1
) as response_document on true
where workflow.current_task = 'insurer_response_received'
  and workflow.current_report_version_id is not null
  and origin.message_version_id is not null
on conflict on constraint total_loss_response_analysis_jobs_response_key do nothing;

update public.total_loss_claim_workflows as workflow
set current_response_analysis_job_id = job.id
from public.total_loss_insurer_response_analysis_jobs as job
where workflow.current_task = 'insurer_response_received'
  and workflow.current_response_analysis_job_id is null
  and job.case_id = workflow.case_id
  and job.negotiation_round_id = workflow.current_negotiation_round_id
  and not exists (
    select 1 from public.total_loss_communications as successor
    where successor.case_id = job.case_id
      and successor.supersedes_communication_id = job.response_communication_id
      and successor.direction = 'inbound'
      and successor.communication_type = 'insurer_response'
      and successor.status = 'confirmed'
  );

create trigger total_loss_claim_workflows_enqueue_response_analysis
before update on public.total_loss_claim_workflows
for each row execute function public.total_loss_enqueue_response_analysis_on_workflow_update();

create function public.protect_total_loss_sealed_insurer_response_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.bucket_id = 'case-files'
    and exists (
      select 1
      from public.total_loss_claim_documents as document
      where document.storage_bucket_id = old.bucket_id
        and document.storage_object_name = old.name
        and document.document_kind = 'insurer_response'
        and document.status = 'ready'
    )
  then
    raise exception using
      errcode = '55000',
      message = 'Sealed insurer-response objects are immutable.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function public.protect_total_loss_sealed_insurer_response_object()
  from public, anon, authenticated, service_role;

create trigger total_loss_insurer_response_objects_protect_sealed
before update or delete on storage.objects
for each row execute function public.protect_total_loss_sealed_insurer_response_object();

create function public.list_due_total_loss_insurer_response_analysis_jobs(
  requested_limit integer
)
returns table (
  job_id uuid,
  case_id uuid,
  attempt_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if requested_limit is null or requested_limit not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'Response-analysis dispatch limit is invalid.';
  end if;

  return query
  select job.id, job.case_id, job.attempt_count
  from public.total_loss_insurer_response_analysis_jobs as job
  join public.total_loss_claim_workflows as workflow
    on workflow.case_id = job.case_id
    and workflow.current_response_analysis_job_id = job.id
  where job.status = 'pending'
    or (
      job.status = 'processing'
      and job.processing_expires_at <= statement_timestamp()
    )
  order by
    case
      when job.status = 'processing' then job.processing_expires_at
      else job.created_at
    end,
    job.created_at,
    job.id
  limit requested_limit;
end;
$$;

comment on function public.list_due_total_loss_insurer_response_analysis_jobs(integer) is
  'Service-only bounded dispatch reconciliation for current pending work and expired leases; retryable failures require an explicit owner retry.';

create function public.resolve_total_loss_insurer_response_analysis_job_case(
  requested_job_id uuid
)
returns table (
  job_id uuid,
  case_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if requested_job_id is null then
    raise exception using
      errcode = '22023',
      message = 'Response-analysis job identity is required.';
  end if;

  return query
  select job.id, job.case_id
  from public.total_loss_insurer_response_analysis_jobs as job
  join public.total_loss_claim_workflows as workflow
    on workflow.case_id = job.case_id
    and workflow.current_response_analysis_job_id = job.id
  where job.id = requested_job_id;
end;
$$;

comment on function public.resolve_total_loss_insurer_response_analysis_job_case(uuid) is
  'Service-only task-callback resolver that accepts only the workflow current response-analysis job identity.';

create function public.claim_current_total_loss_insurer_response_analysis(
  requested_case_id uuid,
  requested_processing_token uuid,
  requested_provider_identifier text,
  requested_model_identifier text,
  requested_prompt_version text,
  requested_schema_version text,
  requested_context_version text
)
returns table (
  outcome text,
  job_id uuid,
  run_id uuid,
  attempt_count integer,
  status text,
  processing_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  workflow_row public.total_loss_claim_workflows%rowtype;
  job_row public.total_loss_insurer_response_analysis_jobs%rowtype;
  run_row public.total_loss_insurer_response_analysis_runs%rowtype;
  next_attempt integer;
begin
  if requested_case_id is null
    or requested_processing_token is null
    or requested_provider_identifier !~ '^[a-z][a-z0-9_-]{0,63}$'
    or requested_model_identifier is null
    or char_length(requested_model_identifier) not between 1 and 255
    or requested_model_identifier ~ '[[:cntrl:]]'
    or requested_prompt_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or requested_schema_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or requested_context_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  then
    raise exception using errcode = '22023', message = 'Response-analysis claim is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_insurer_response_analysis'),
    pg_catalog.hashtext(requested_case_id::text)
  );

  select * into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = requested_case_id
  for update;

  if not found or workflow_row.current_response_analysis_job_id is null then
    return query select 'not_found'::text, null::uuid, null::uuid,
      null::integer, null::text, null::timestamptz;
    return;
  end if;

  select * into job_row
  from public.total_loss_insurer_response_analysis_jobs as job
  where job.id = workflow_row.current_response_analysis_job_id
    and job.case_id = requested_case_id
  for update;

  if not found then
    raise exception using errcode = '55000', message = 'Current response-analysis job is unavailable.';
  end if;

  if job_row.status in ('completed', 'terminal_failed', 'unsupported', 'superseded') then
    return query select job_row.status, job_row.id, job_row.current_run_id,
      job_row.attempt_count, job_row.status, job_row.processing_expires_at;
    return;
  end if;

  if job_row.status = 'retryable_failed' then
    return query select 'retry_scheduled'::text, job_row.id,
      job_row.current_run_id, job_row.attempt_count, job_row.status,
      job_row.processing_expires_at;
    return;
  end if;

  if job_row.status = 'processing'
    and job_row.processing_expires_at > statement_timestamp()
  then
    select * into run_row
    from public.total_loss_insurer_response_analysis_runs as run
    where run.id = job_row.current_run_id
      and run.job_id = job_row.id;

    if job_row.processing_token = requested_processing_token then
      if not found
        or run_row.provider_identifier <> requested_provider_identifier
        or run_row.model_identifier <> requested_model_identifier
        or run_row.prompt_version <> requested_prompt_version
        or run_row.schema_version <> requested_schema_version
        or run_row.context_version <> requested_context_version
      then
        raise exception using errcode = '55000', message = 'Processing token was already used with different analysis configuration.';
      end if;

      return query select 'claimed'::text, job_row.id, run_row.id,
        job_row.attempt_count, job_row.status, job_row.processing_expires_at;
    else
      return query select 'processing'::text, job_row.id, job_row.current_run_id,
        job_row.attempt_count, job_row.status, job_row.processing_expires_at;
    end if;
    return;
  end if;

  if job_row.status = 'processing' then
    update public.total_loss_insurer_response_analysis_runs as run
    set status = 'retryable_failed',
        failure_code = 'WORK_LEASE_EXPIRED',
        completed_at = statement_timestamp()
    where run.id = job_row.current_run_id
      and run.job_id = job_row.id
      and run.status = 'processing';
  end if;

  next_attempt := job_row.attempt_count + 1;
  insert into public.total_loss_insurer_response_analysis_runs (
    case_id,
    job_id,
    attempt_number,
    provider_identifier,
    model_identifier,
    prompt_version,
    schema_version,
    context_version,
    status
  ) values (
    job_row.case_id,
    job_row.id,
    next_attempt,
    requested_provider_identifier,
    requested_model_identifier,
    requested_prompt_version,
    requested_schema_version,
    requested_context_version,
    'processing'
  ) returning * into run_row;

  update public.total_loss_insurer_response_analysis_jobs as job
  set status = 'processing',
      attempt_count = next_attempt,
      processing_token = requested_processing_token,
      processing_expires_at = statement_timestamp() + interval '30 minutes',
      current_run_id = run_row.id,
      failure_code = null,
      retryable = null,
      completed_at = null,
      failed_at = null,
      next_attempt_at = statement_timestamp()
  where job.id = job_row.id
  returning * into job_row;

  update public.total_loss_claim_workflows as workflow
  set revision = workflow.revision + 1
  where workflow.case_id = requested_case_id
    and workflow.current_response_analysis_job_id = job_row.id;

  return query select 'claimed'::text, job_row.id, run_row.id,
    job_row.attempt_count, job_row.status, job_row.processing_expires_at;
end;
$$;

comment on function public.claim_current_total_loss_insurer_response_analysis(uuid, uuid, text, text, text, text, text) is
  'Service-only idempotent current-job claim with a rotating execution lease and immutable per-attempt provider configuration.';

create function public.resolve_total_loss_insurer_response_analysis_context(
  requested_job_id uuid,
  requested_processing_token uuid
)
returns table (
  job_id uuid,
  run_id uuid,
  case_id uuid,
  analysis_context jsonb,
  response_document_id uuid,
  response_document_bucket text,
  response_document_object_name text,
  response_document_media_type text,
  response_document_byte_size bigint,
  response_document_content_digest text,
  existing_extraction_version text,
  existing_extraction jsonb,
  existing_extraction_digest text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    job.id,
    run.id,
    job.case_id,
    jsonb_build_object(
      'contextVersion', run.context_version,
      'vehicle', jsonb_build_object(
        'vin', details.vin,
        'year', details.vehicle_year,
        'make', details.vehicle_make,
        'model', details.vehicle_model,
        'trim', details.vehicle_trim,
        'mileageAtLoss', details.mileage_at_loss
      ),
      'insurer', jsonb_build_object(
        'name', details.insurer_name,
        'originalOffer', report_version.report #> '{executiveConclusion,insurerValuation,value}'
      ),
      'venfourAssessment', jsonb_build_object(
        'conclusionCode', final_assessment.conclusion_code,
        'supportedRange', jsonb_build_object(
          'lowMinorUnits', final_assessment.supported_range_low_minor_units,
          'medianMinorUnits', final_assessment.supported_range_median_minor_units,
          'highMinorUnits', final_assessment.supported_range_high_minor_units,
          'currency', final_assessment.currency
        ),
        'findings', final_assessment.findings,
        'limitations', final_assessment.limitations,
        'reasonCodes', final_assessment.reason_codes,
        'insurerComparableReview', report_version.report -> 'insurerComparableReview',
        'independentMarketEvidence', report_version.report -> 'independentMarketEvidence'
      ),
      'customerRequest', jsonb_build_object(
        'subject', source_message.subject,
        'body', source_message.body,
        'customerReportedSentAt', source_message.sent_at
      ),
      'insurerResponse', jsonb_build_object(
        'text', response.original_content,
        'receivedAt', response.occurred_at,
        'document', case when document.id is null then null else jsonb_build_object(
          'originalFilename', document.original_filename,
          'mediaType', document.media_type,
          'byteSize', document.byte_size
        ) end,
        'customerRecordedRevisedOffer', case when offer.id is null then null else jsonb_build_object(
          'amountMinorUnits', offer.amount_minor_units,
          'currency', offer.currency
        ) end
      ),
      'journey', jsonb_build_object(
        'phase', workflow.phase::text,
        'currentTask', workflow.current_task,
        'negotiationRoundNumber', negotiation_round.round_number
      )
    ),
    document.id,
    document.storage_bucket_id,
    document.storage_object_name,
    document.media_type,
    document.byte_size,
    document.content_digest,
    extraction.extraction_version,
    extraction.extraction,
    extraction.extraction_digest
  from public.total_loss_insurer_response_analysis_jobs as job
  join public.total_loss_insurer_response_analysis_runs as run
    on run.id = job.current_run_id
    and run.job_id = job.id
    and run.case_id = job.case_id
    and run.status = 'processing'
  join public.total_loss_claim_workflows as workflow
    on workflow.case_id = job.case_id
    and workflow.current_response_analysis_job_id = job.id
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
  join public.total_loss_message_versions as source_message
    on source_message.id = job.source_message_version_id
    and source_message.case_id = job.case_id
    and source_message.message_state = 'customer_reported_sent'
  join public.total_loss_report_versions as report_version
    on report_version.id = job.source_report_version_id
    and report_version.case_id = job.case_id
    and report_version.status = 'published'
  join public.total_loss_final_assessments as final_assessment
    on final_assessment.id = report_version.final_assessment_id
    and final_assessment.case_id = report_version.case_id
  join public.total_loss_case_details as details
    on details.case_id = job.case_id
  left join public.total_loss_claim_documents as document
    on document.id = job.source_document_id
    and document.case_id = job.case_id
    and document.document_kind = 'insurer_response'
    and document.status = 'ready'
  left join public.total_loss_offers as offer
    on offer.source_communication_id = response.id
    and offer.case_id = response.case_id
    and offer.status = 'recorded'
  left join lateral (
    select extraction_row.*
    from public.total_loss_insurer_response_document_extractions as extraction_row
    where extraction_row.document_id = document.id
      and extraction_row.case_id = document.case_id
    order by extraction_row.created_at desc, extraction_row.id desc
    limit 1
  ) as extraction on true
  where job.id = requested_job_id
    and job.status = 'processing'
    and job.processing_token = requested_processing_token
    and job.processing_expires_at > statement_timestamp()
    and not exists (
      select 1 from public.total_loss_communications as successor
      where successor.case_id = response.case_id
        and successor.supersedes_communication_id = response.id
        and successor.direction = 'inbound'
        and successor.communication_type = 'insurer_response'
        and successor.status = 'confirmed'
    );
$$;

comment on function public.resolve_total_loss_insurer_response_analysis_context(uuid, uuid) is
  'Service-only active-lease context assembler. Model context is explicitly allowlisted; private document locators are separate worker fields.';

create function public.total_loss_response_analysis_result_is_valid(
  requested_result jsonb,
  requested_schema_version text
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    jsonb_typeof($1) = 'object'
    and pg_column_size($1) <= 524288
    and $1 ->> 'schemaVersion' = $2
    and $1 ?& array[
      'schemaVersion',
      'analysisSummary',
      'insurerPosition',
      'revisedOffer',
      'requestDisposition',
      'responsePoints',
      'insurerArguments',
      'importantChanges',
      'unresolvedIssues',
      'recommendedNextStep',
      'confidence',
      'uncertainties',
      'inputCoverage',
      'untrustedInstructionDetected',
      'untrustedInstructionFollowed'
    ]
    and not exists (
      select 1
      from jsonb_object_keys($1) as key
      where key <> all (array[
        'schemaVersion',
        'analysisSummary',
        'insurerPosition',
        'revisedOffer',
        'requestDisposition',
        'responsePoints',
        'insurerArguments',
        'importantChanges',
        'unresolvedIssues',
        'recommendedNextStep',
        'confidence',
        'uncertainties',
        'inputCoverage',
        'untrustedInstructionDetected',
        'untrustedInstructionFollowed'
      ])
    )
    and jsonb_typeof($1 -> 'analysisSummary') = 'object'
    and ($1 -> 'analysisSummary') ?& array[
      'whatInsurerSaid',
      'whatThisMeans',
      'responseEvidenceRefs',
      'caseEvidenceRefs'
    ]
    and (
      select count(*) = 4
      from jsonb_object_keys($1 -> 'analysisSummary')
    )
    and jsonb_typeof($1 #> '{analysisSummary,whatInsurerSaid}') = 'string'
    and char_length($1 #>> '{analysisSummary,whatInsurerSaid}') between 1 and 2000
    and jsonb_typeof($1 #> '{analysisSummary,whatThisMeans}') = 'string'
    and char_length($1 #>> '{analysisSummary,whatThisMeans}') between 1 and 2000
    and case
      when jsonb_typeof(
        $1 #> '{analysisSummary,responseEvidenceRefs}'
      ) = 'array'
        then jsonb_array_length(
          $1 #> '{analysisSummary,responseEvidenceRefs}'
        ) between 1 and 100
      else false
    end
    and case
      when jsonb_typeof(
        $1 #> '{analysisSummary,caseEvidenceRefs}'
      ) = 'array'
        then jsonb_array_length(
          $1 #> '{analysisSummary,caseEvidenceRefs}'
        ) between 1 and 100
      else false
    end
    and jsonb_typeof($1 -> 'insurerPosition') = 'object'
    and jsonb_typeof($1 -> 'requestDisposition') = 'object'
    and $1 #>> '{requestDisposition,category}' in (
      'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED',
      'MORE_INFORMATION_REQUESTED', 'UNCLEAR'
    )
    and jsonb_typeof($1 -> 'responsePoints') = 'array'
    and jsonb_typeof($1 -> 'insurerArguments') = 'array'
    and jsonb_typeof($1 -> 'importantChanges') = 'array'
    and jsonb_typeof($1 -> 'unresolvedIssues') = 'array'
    and jsonb_typeof($1 -> 'recommendedNextStep') = 'object'
    and ($1 #>> '{recommendedNextStep,category}') in (
      'REVIEW_REVISED_OFFER',
      'MORE_INFORMATION_MAY_BE_NEEDED',
      'FOLLOW_UP_APPEARS_WARRANTED',
      'VALUATION_ISSUE_APPEARS_RESOLVED',
      'REVIEW_RESPONSE'
    )
    and jsonb_typeof($1 -> 'confidence') = 'string'
    and $1 ->> 'confidence' in ('HIGH', 'MEDIUM', 'LOW')
    and jsonb_typeof($1 -> 'uncertainties') = 'array'
    and jsonb_typeof($1 -> 'inputCoverage') = 'object'
    and jsonb_typeof($1 -> 'untrustedInstructionDetected') = 'boolean'
    and $1 -> 'untrustedInstructionFollowed' = 'false'::jsonb
    and (
      $1 -> 'revisedOffer' = 'null'::jsonb
      or jsonb_typeof($1 -> 'revisedOffer') = 'object'
    );
$$;

revoke execute on function public.total_loss_response_analysis_result_is_valid(jsonb, text)
  from public, anon, authenticated, service_role;

create function public.complete_total_loss_insurer_response_analysis(
  requested_job_id uuid,
  requested_processing_token uuid,
  requested_run_id uuid,
  requested_returned_model_identifier text,
  requested_input_digest text,
  requested_result jsonb,
  requested_result_digest text,
  requested_usage_metadata jsonb,
  requested_extraction_version text,
  requested_extraction jsonb,
  requested_extraction_digest text,
  requested_verified_document_digest text,
  requested_evidence_index jsonb,
  requested_evidence_index_digest text
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
  result_row public.total_loss_insurer_response_analysis_results%rowtype;
  document_row public.total_loss_claim_documents%rowtype;
  extraction_row public.total_loss_insurer_response_document_extractions%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
begin
  if requested_job_id is null
    or requested_processing_token is null
    or requested_run_id is null
    or requested_returned_model_identifier is null
    or char_length(requested_returned_model_identifier) not between 1 and 255
    or requested_returned_model_identifier ~ '[[:cntrl:]]'
    or requested_input_digest !~ '^[0-9a-f]{64}$'
    or requested_result_digest !~ '^[0-9a-f]{64}$'
    or requested_result_digest <> public.total_loss_canonical_jsonb_digest(requested_result)
    or requested_evidence_index_digest !~ '^[0-9a-f]{64}$'
    or requested_evidence_index_digest <>
      public.total_loss_canonical_jsonb_digest(requested_evidence_index)
    or public.total_loss_response_analysis_evidence_index_is_valid(
      requested_evidence_index,
      requested_result
    ) is not true
    or requested_usage_metadata is not null
      and (
        jsonb_typeof(requested_usage_metadata) <> 'object'
        or pg_column_size(requested_usage_metadata) > 65536
      )
  then
    raise exception using errcode = '22023', message = 'Response-analysis completion is invalid.';
  end if;

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

  if job_row.status = 'completed' then
    select * into result_row
    from public.total_loss_insurer_response_analysis_results as result
    where result.job_id = job_row.id;
    if job_row.processing_token = requested_processing_token
      and job_row.current_run_id = requested_run_id
      and result_row.input_digest = requested_input_digest
      and result_row.result_digest = requested_result_digest
      and result_row.result = requested_result
      and result_row.evidence_index_digest = requested_evidence_index_digest
      and result_row.evidence_index = requested_evidence_index
    then
      select * into workflow_row from public.total_loss_claim_workflows
      where case_id = job_row.case_id;
      return query select 'duplicate'::text, job_row.status, workflow_row.revision;
      return;
    end if;
    raise exception using errcode = '55000', message = 'Completed response analysis conflicts with this result.';
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
    and run.case_id = job_row.case_id
    and run.status = 'processing'
  for update;
  if not found then
    raise exception using errcode = '40001', message = 'Response-analysis run is no longer active.';
  end if;

  if not public.total_loss_response_analysis_result_is_valid(
    requested_result, run_row.schema_version
  ) then
    raise exception using errcode = '22023', message = 'Structured response-analysis result is invalid.';
  end if;

  select * into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = job_row.case_id
  for update;
  if not found
    or workflow_row.current_response_analysis_job_id <> job_row.id
    or not exists (
      select 1
      from public.total_loss_communications as response
      where response.id = job_row.response_communication_id
        and response.case_id = job_row.case_id
        and response.status = 'confirmed'
        and not exists (
          select 1 from public.total_loss_communications as successor
          where successor.case_id = response.case_id
            and successor.supersedes_communication_id = response.id
            and successor.direction = 'inbound'
            and successor.communication_type = 'insurer_response'
            and successor.status = 'confirmed'
        )
    )
  then
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

  if job_row.source_document_id is null then
    if requested_verified_document_digest is not null then
      raise exception using errcode = '22023', message = 'Text-only response analysis cannot verify document bytes.';
    end if;
  elsif requested_extraction is not null then
    if requested_extraction_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      or requested_extraction_digest !~ '^[0-9a-f]{64}$'
      or requested_extraction_digest <> public.total_loss_canonical_jsonb_digest(requested_extraction)
      or requested_verified_document_digest !~ '^[0-9a-f]{64}$'
    then
      raise exception using errcode = '22023', message = 'Response-document extraction is invalid.';
    end if;

    select * into document_row
    from public.total_loss_claim_documents as document
    where document.id = job_row.source_document_id
      and document.case_id = job_row.case_id
      and document.document_kind = 'insurer_response'
      and document.status = 'ready';
    if not found
      or document_row.content_digest <> requested_verified_document_digest
    then
      raise exception using errcode = '55000', message = 'Verified response-document bytes do not match the sealed source.';
    end if;

    insert into public.total_loss_insurer_response_document_extractions (
      case_id, document_id, extraction_version, source_content_digest,
      verified_content_digest, extraction, extraction_digest
    ) values (
      job_row.case_id, document_row.id, requested_extraction_version,
      document_row.content_digest, requested_verified_document_digest,
      requested_extraction, requested_extraction_digest
    )
    on conflict on constraint total_loss_response_extractions_document_version_key
    do nothing;

    select * into extraction_row
    from public.total_loss_insurer_response_document_extractions as extraction
    where extraction.document_id = document_row.id
      and extraction.extraction_version = requested_extraction_version;
    if extraction_row.source_content_digest <> document_row.content_digest
      or extraction_row.verified_content_digest <> requested_verified_document_digest
      or extraction_row.extraction_digest <> requested_extraction_digest
      or extraction_row.extraction <> requested_extraction
    then
      raise exception using errcode = '55000', message = 'Response-document extraction version conflicts with existing derived data.';
    end if;
  elsif requested_extraction_version is not null
    or requested_extraction_digest is not null
    or requested_verified_document_digest is not null
  then
    raise exception using errcode = '22023', message = 'Response-document extraction metadata is incomplete.';
  end if;

  insert into public.total_loss_insurer_response_analysis_results (
    case_id, job_id, run_id, response_communication_id, schema_version,
    input_digest, result, result_digest, evidence_index, evidence_index_digest
  ) values (
    job_row.case_id, job_row.id, run_row.id, job_row.response_communication_id,
    run_row.schema_version, requested_input_digest, requested_result,
    requested_result_digest, requested_evidence_index,
    requested_evidence_index_digest
  ) returning * into result_row;

  update public.total_loss_insurer_response_analysis_runs
  set returned_model_identifier = requested_returned_model_identifier,
      input_digest = requested_input_digest,
      output_digest = requested_result_digest,
      status = 'completed',
      usage_metadata = requested_usage_metadata,
      completed_at = statement_timestamp()
  where id = run_row.id;

  update public.total_loss_insurer_response_analysis_jobs
  set status = 'completed',
      processing_expires_at = null,
      failure_code = null,
      retryable = null,
      completed_at = statement_timestamp(),
      failed_at = null
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
    job_row.case_id, 'insurer_response.analysis_completed', 'system',
    'total_loss_insurer_response_analysis_result', result_row.id,
    jsonb_build_object(
      'responseId', job_row.response_communication_id,
      'analysisSchemaVersion', run_row.schema_version,
      'workflowRevision', workflow_row.revision
    )
  );

  return query select 'completed'::text, 'completed'::text, workflow_row.revision;
end;
$$;

comment on function public.complete_total_loss_insurer_response_analysis(uuid, uuid, uuid, text, text, jsonb, text, jsonb, text, jsonb, text, text, jsonb, text) is
  'Service-only, lease-fenced persistence of one strict structured result and optional verified derived extraction; stale corrections cannot advance the workflow.';

create function public.fail_total_loss_insurer_response_analysis(
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

  if job_row.status = terminal_status
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
      'workflowRevision', workflow_row.revision
    )
  );

  return query select terminal_status, terminal_status, workflow_row.revision;
end;
$$;

comment on function public.fail_total_loss_insurer_response_analysis(uuid, uuid, uuid, text, text, integer) is
  'Service-only failure transition distinguishing retryable, terminal, and unsupported material without exposing provider errors.';

create function public.retry_total_loss_insurer_response_analysis(
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
    raise exception using errcode = '40001', message = 'Claim workflow changed before response-analysis retry.';
  end if;

  select * into job_row
  from public.total_loss_insurer_response_analysis_jobs as job
  where job.id = workflow_row.current_response_analysis_job_id
    and job.case_id = requested_case_id
  for update;
  if not found or job_row.status <> 'retryable_failed' then
    raise exception using errcode = '55000', message = 'Response analysis is not retryable.';
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
    raise exception using errcode = '40001', message = 'Claim workflow changed before response-analysis retry.';
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

comment on function public.retry_total_loss_insurer_response_analysis(uuid, uuid, bigint) is
  'Permanent-owner, revision-fenced, idempotent retry request; it only requeues the current retryable job and performs no provider work.';

create or replace function public.total_loss_insurer_response_projection_internal(
  requested_case_id uuid,
  requested_response_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  communication_row public.total_loss_communications%rowtype;
  event_row public.total_loss_workflow_events%rowtype;
  document_row public.total_loss_claim_documents%rowtype;
  offer_row public.total_loss_offers%rowtype;
  job_row public.total_loss_insurer_response_analysis_jobs%rowtype;
  result_row public.total_loss_insurer_response_analysis_results%rowtype;
  projected_offer_id uuid;
  processing_state text := 'not_started';
  projection jsonb;
begin
  select communication.* into communication_row
  from public.total_loss_communications as communication
  where communication.id = requested_response_id
    and communication.case_id = requested_case_id
    and communication.direction = 'inbound'
    and communication.communication_type = 'insurer_response'
    and communication.status = 'confirmed';
  if not found then return null; end if;

  select event.* into event_row
  from public.total_loss_workflow_events as event
  where event.case_id = requested_case_id
    and event.event_type = 'insurer_response.recorded'
    and event.associated_entity_type = 'total_loss_communication'
    and event.associated_entity_id = communication_row.id
  order by event.created_at, event.id
  limit 1;
  if not found then return null; end if;

  select document.* into document_row
  from public.total_loss_communication_documents as communication_document
  join public.total_loss_claim_documents as document
    on document.id = communication_document.document_id
    and document.case_id = communication_document.case_id
  where communication_document.case_id = requested_case_id
    and communication_document.communication_id = communication_row.id
    and document.status = 'ready'
  order by communication_document.display_order, document.id
  limit 1;

  if event_row.details ->> 'offerId' ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    projected_offer_id := (event_row.details ->> 'offerId')::uuid;
    select offer.* into offer_row
    from public.total_loss_offers as offer
    where offer.id = projected_offer_id
      and offer.case_id = requested_case_id;
  end if;

  select * into job_row
  from public.total_loss_insurer_response_analysis_jobs as job
  where job.response_communication_id = communication_row.id;
  if found then
    processing_state := case job_row.status
      when 'pending' then 'pending'
      when 'superseded' then 'terminal_failed'
      else job_row.status
    end;
    if job_row.status = 'completed' then
      select * into result_row
      from public.total_loss_insurer_response_analysis_results as result
      where result.job_id = job_row.id;
    end if;
  end if;

  projection := jsonb_build_object(
    'responseId', communication_row.id,
    'clientRequestId', event_row.client_request_id,
    'receivedAt', communication_row.occurred_at,
    'sourceType', case
      when document_row.id is not null then 'uploaded_document'
      else 'pasted_message'
    end,
    'text', communication_row.original_content,
    'document', case when document_row.id is null then null else jsonb_build_object(
      'documentId', document_row.id,
      'originalFilename', document_row.original_filename,
      'mediaType', document_row.media_type,
      'byteSize', document_row.byte_size
    ) end,
    'revisedOffer', case when offer_row.id is null then null else jsonb_build_object(
      'amountMinorUnits', offer_row.amount_minor_units,
      'currency', offer_row.currency
    ) end,
    'processingState', processing_state,
    'supersedesResponseId', communication_row.supersedes_communication_id
  );

  if result_row.id is not null then
    projection := projection || jsonb_build_object(
      'analysis', result_row.result,
      'analysisEvidence', result_row.evidence_index
    );
  end if;

  return projection;
end;
$$;

comment on function public.total_loss_insurer_response_projection_internal(uuid, uuid) is
  'Customer-safe current response and structured interpretation; storage, job, run, provider, model, prompt, usage, and digest metadata are omitted.';

revoke execute on function public.total_loss_insurer_response_projection_internal(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Preserve the complete mature resolver as an internal base and add only the
-- response-analysis state projection around it.
alter function public.resolve_total_loss_case_claim(uuid)
  rename to resolve_total_loss_case_claim_before_response_analysis;

revoke execute on function public.resolve_total_loss_case_claim_before_response_analysis(uuid)
  from public, anon, authenticated, service_role;

create function public.resolve_total_loss_case_claim(requested_case_id uuid)
returns setof public.total_loss_case_claim_resume_result
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result_row public.total_loss_case_claim_resume_result;
  workflow_row public.total_loss_claim_workflows%rowtype;
  job_row public.total_loss_insurer_response_analysis_jobs%rowtype;
  projected_task text;
  projected_state text;
  projected_retryable boolean;
begin
  select * into result_row
  from public.resolve_total_loss_case_claim_before_response_analysis(requested_case_id);
  if not found then return; end if;

  if result_row.state <> 'secured'
    or result_row.workflow_current_task <> 'insurer_response_received'
  then
    return next result_row;
    return;
  end if;

  select * into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = requested_case_id;
  if workflow_row.current_response_analysis_job_id is null then
    return next result_row;
    return;
  end if;

  select * into job_row
  from public.total_loss_insurer_response_analysis_jobs as job
  where job.id = workflow_row.current_response_analysis_job_id
    and job.case_id = requested_case_id;
  if not found then
    return next result_row;
    return;
  end if;

  if job_row.status in ('pending', 'processing', 'retryable_failed') then
    projected_task := 'insurer_response_reviewing';
    projected_state := 'insurer_response_reviewing';
    projected_retryable := job_row.status = 'retryable_failed';
  elsif job_row.status = 'completed' then
    projected_task := 'insurer_response_reviewed';
    projected_state := 'insurer_response_reviewed';
    projected_retryable := false;
  else
    projected_task := 'insurer_response_review_unavailable';
    projected_state := 'insurer_response_review_unavailable';
    projected_retryable := false;
  end if;

  result_row.workflow_current_task := projected_task;
  result_row.next_task := projected_task;
  result_row.customer_journey := jsonb_build_object(
    'nextState', projected_state,
    'fulfillmentState', projected_state,
    'retryable', projected_retryable
  );
  result_row.insurer_response :=
    public.total_loss_current_insurer_response_projection_internal(requested_case_id);
  return next result_row;
end;
$$;

comment on function public.resolve_total_loss_case_claim(uuid) is
  'Owner-safe authoritative resume projection extended with reviewing, reviewed, and unavailable insurer-response analysis states.';

revoke execute on function public.resolve_total_loss_case_claim(uuid)
  from public, anon, service_role;
grant execute on function public.resolve_total_loss_case_claim(uuid)
  to authenticated;

alter table public.total_loss_insurer_response_analysis_jobs enable row level security;
alter table public.total_loss_insurer_response_analysis_runs enable row level security;
alter table public.total_loss_insurer_response_document_extractions enable row level security;
alter table public.total_loss_insurer_response_analysis_results enable row level security;

revoke all on table
  public.total_loss_insurer_response_analysis_jobs,
  public.total_loss_insurer_response_analysis_runs,
  public.total_loss_insurer_response_document_extractions,
  public.total_loss_insurer_response_analysis_results
from public, anon, authenticated, service_role;

revoke execute on function public.list_due_total_loss_insurer_response_analysis_jobs(integer)
  from public, anon, authenticated;
grant execute on function public.list_due_total_loss_insurer_response_analysis_jobs(integer)
  to service_role;

revoke execute on function public.resolve_total_loss_insurer_response_analysis_job_case(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_total_loss_insurer_response_analysis_job_case(uuid)
  to service_role;

revoke execute on function public.claim_current_total_loss_insurer_response_analysis(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_current_total_loss_insurer_response_analysis(uuid, uuid, text, text, text, text, text)
  to service_role;

revoke execute on function public.resolve_total_loss_insurer_response_analysis_context(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_total_loss_insurer_response_analysis_context(uuid, uuid)
  to service_role;

revoke execute on function public.complete_total_loss_insurer_response_analysis(uuid, uuid, uuid, text, text, jsonb, text, jsonb, text, jsonb, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.complete_total_loss_insurer_response_analysis(uuid, uuid, uuid, text, text, jsonb, text, jsonb, text, jsonb, text, text, jsonb, text)
  to service_role;

revoke execute on function public.fail_total_loss_insurer_response_analysis(uuid, uuid, uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.fail_total_loss_insurer_response_analysis(uuid, uuid, uuid, text, text, integer)
  to service_role;

revoke execute on function public.retry_total_loss_insurer_response_analysis(uuid, uuid, bigint)
  from public, anon, service_role;
grant execute on function public.retry_total_loss_insurer_response_analysis(uuid, uuid, bigint)
  to authenticated;

notify pgrst, 'reload schema';
