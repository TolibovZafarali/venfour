create type public.total_loss_analysis_status as enum (
  'processing',
  'completed',
  'failed'
);

create type public.total_loss_analysis_outcome as enum (
  'claimed',
  'not_submitted',
  'processing',
  'completed',
  'failed',
  'not_found',
  'report_intake_required',
  'intake_not_ready',
  'postal_code_required',
  'invalid_postal_code',
  'report_required',
  'case_not_ready'
);

comment on type public.total_loss_analysis_status is
  'Trusted-worker state for one total-loss analysis attempt group.';
comment on type public.total_loss_analysis_outcome is
  'Typed claim and status outcomes returned to the trusted application backend.';

create type public.total_loss_analysis_result as (
  outcome public.total_loss_analysis_outcome,
  job_id uuid,
  status public.total_loss_analysis_status,
  attempt_count integer,
  run_id uuid,
  postal_code text,
  failure_code text,
  retryable boolean,
  processing_expires_at timestamptz
);

comment on type public.total_loss_analysis_result is
  'The non-sensitive job coordination projection returned by trusted analysis RPCs.';

create table public.total_loss_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete cascade,
  source_report_upload_id uuid not null,
  source_details_updated_at timestamptz not null,
  status public.total_loss_analysis_status not null default 'processing',
  attempt_count integer not null default 1,
  processing_token uuid not null,
  processing_expires_at timestamptz,
  run_id uuid not null default gen_random_uuid(),
  failure_code text,
  retryable boolean,
  finished_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_analysis_jobs_case_source_key
    unique (case_id, source_report_upload_id),
  constraint total_loss_analysis_jobs_id_case_key
    unique (id, case_id),
  constraint total_loss_analysis_jobs_run_id_key
    unique (run_id),
  constraint total_loss_analysis_jobs_run_identity_key
    unique (run_id, id, case_id),
  constraint total_loss_analysis_jobs_attempt_count_valid
    check (attempt_count >= 1),
  constraint total_loss_analysis_jobs_failure_code_safe
    check (
      failure_code is null
      or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
  constraint total_loss_analysis_jobs_state_complete
    check (
      (
        status = 'processing'
        and processing_expires_at is not null
        and failure_code is null
        and retryable is null
        and finished_at is null
      )
      or (
        status = 'completed'
        and processing_expires_at is null
        and failure_code is null
        and retryable is null
        and finished_at is not null
      )
      or (
        status = 'failed'
        and processing_expires_at is null
        and failure_code is not null
        and retryable is not null
        and finished_at is not null
      )
    )
);

comment on table public.total_loss_analysis_jobs is
  'Durable service-owned coordination for total-loss analysis, idempotent per finalized report upload.';
comment on column public.total_loss_analysis_jobs.source_report_upload_id is
  'The finalized report upload token and natural idempotency key for this case.';
comment on column public.total_loss_analysis_jobs.source_details_updated_at is
  'The customer-visible details version used by the current processing attempt.';
comment on column public.total_loss_analysis_jobs.processing_token is
  'An unguessable trusted-worker lease token retained for terminal-call idempotency.';
comment on column public.total_loss_analysis_jobs.failure_code is
  'A bounded machine-readable code; provider messages and sensitive error text do not belong here.';

create unique index total_loss_analysis_jobs_one_processing_per_case_idx
  on public.total_loss_analysis_jobs (case_id)
  where status = 'processing';

create index total_loss_analysis_jobs_case_created_idx
  on public.total_loss_analysis_jobs (case_id, created_at desc);

create table public.analysis_runs (
  id uuid primary key,
  job_id uuid not null unique,
  case_id uuid not null,
  artifact jsonb not null,
  request_digest text not null,
  search_diagnostics_digest text,
  analysis_run_schema_version text not null,
  analysis_version text not null,
  discrepancy_analysis_version text not null,
  comparable_scoring_version text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint analysis_runs_job_identity_fkey
    foreign key (id, job_id, case_id)
    references public.total_loss_analysis_jobs (run_id, id, case_id)
    on delete cascade,
  constraint analysis_runs_artifact_object
    check (jsonb_typeof(artifact) = 'object'),
  constraint analysis_runs_artifact_id_matches
    check ((artifact ->> 'runId') is not distinct from id::text),
  constraint analysis_runs_request_digest_valid
    check (request_digest ~ '^[0-9a-f]{64}$'),
  constraint analysis_runs_search_digest_valid
    check (
      search_diagnostics_digest is null
      or search_diagnostics_digest ~ '^[0-9a-f]{64}$'
    ),
  constraint analysis_runs_versions_nonblank
    check (
      analysis_run_schema_version ~ '^[0-9]{1,16}$'
      and analysis_version ~ '^[0-9]{1,16}$'
      and discrepancy_analysis_version ~ '^[0-9]{1,16}$'
      and comparable_scoring_version ~ '^[0-9]{1,16}$'
    )
);

comment on table public.analysis_runs is
  'Immutable validated analysis audit artifacts. Customer-facing presentation remains a deterministic projection.';
comment on column public.analysis_runs.artifact is
  'The authoritative Python analysis-run artifact; browser roles have no direct access.';

create trigger total_loss_analysis_jobs_set_updated_at
before update on public.total_loss_analysis_jobs
for each row execute function public.set_updated_at();

create function public.reject_analysis_run_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'Analysis runs are immutable.';
end;
$$;

comment on function public.reject_analysis_run_update() is
  'Trigger-only guard that prevents mutation of a persisted analysis artifact.';

revoke execute on function public.reject_analysis_run_update() from public;
revoke execute on function public.reject_analysis_run_update() from anon;
revoke execute on function public.reject_analysis_run_update() from authenticated;
revoke execute on function public.reject_analysis_run_update() from service_role;

create trigger analysis_runs_reject_update
before update on public.analysis_runs
for each row execute function public.reject_analysis_run_update();

alter table public.total_loss_analysis_jobs enable row level security;
alter table public.analysis_runs enable row level security;

revoke all on table public.total_loss_analysis_jobs from public;
revoke all on table public.total_loss_analysis_jobs from anon;
revoke all on table public.total_loss_analysis_jobs from authenticated;
revoke all on table public.total_loss_analysis_jobs from service_role;
grant select on table public.total_loss_analysis_jobs to service_role;

revoke all on table public.analysis_runs from public;
revoke all on table public.analysis_runs from anon;
revoke all on table public.analysis_runs from authenticated;
revoke all on table public.analysis_runs from service_role;
grant select on table public.analysis_runs to service_role;

revoke all on type public.total_loss_analysis_status from public;
revoke all on type public.total_loss_analysis_status from anon;
revoke all on type public.total_loss_analysis_status from authenticated;
grant usage on type public.total_loss_analysis_status to service_role;

revoke all on type public.total_loss_analysis_outcome from public;
revoke all on type public.total_loss_analysis_outcome from anon;
revoke all on type public.total_loss_analysis_outcome from authenticated;
grant usage on type public.total_loss_analysis_outcome to service_role;

revoke all on type public.total_loss_analysis_result from public;
revoke all on type public.total_loss_analysis_result from anon;
revoke all on type public.total_loss_analysis_result from authenticated;
grant usage on type public.total_loss_analysis_result to service_role;

create function public.claim_total_loss_analysis(
  case_id uuid,
  user_id uuid,
  processing_token uuid
)
returns setof public.total_loss_analysis_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  case_row public.appraisal_cases%rowtype;
  details_row public.total_loss_case_details%rowtype;
  job_row public.total_loss_analysis_jobs%rowtype;
  result_row public.total_loss_analysis_result;
  normalized_postal_code text;
  job_found boolean := false;
begin
  if $1 is null or $2 is null or $3 is null then
    raise exception using
      errcode = '22023',
      message = 'Case, user, and processing identifiers are required.';
  end if;

  select appraisal_case.*
  into case_row
  from public.appraisal_cases as appraisal_case
  where appraisal_case.id = $1
    and appraisal_case.user_id = $2
    and appraisal_case.service_type = 'total_loss'
  for update;

  if not found then
    result_row.outcome := 'not_found';
    return next result_row;
    return;
  end if;

  select details.*
  into details_row
  from public.total_loss_case_details as details
  where details.case_id = $1
  for update;

  if not found then
    result_row.outcome := 'report_intake_required';
    return next result_row;
    return;
  end if;

  normalized_postal_code := nullif(btrim(details_row.postal_code), '');
  result_row.postal_code := normalized_postal_code;

  if details_row.report_last_upload_id is not null then
    select analysis_job.*
    into job_row
    from public.total_loss_analysis_jobs as analysis_job
    where analysis_job.case_id = $1
      and analysis_job.source_report_upload_id = details_row.report_last_upload_id
    for update;
    job_found := found;
  end if;

  if job_found and job_row.status = 'completed' then
    result_row.outcome := 'completed';
    result_row.job_id := job_row.id;
    result_row.status := job_row.status;
    result_row.attempt_count := job_row.attempt_count;
    result_row.run_id := job_row.run_id;
    result_row.failure_code := job_row.failure_code;
    result_row.retryable := job_row.retryable;
    result_row.processing_expires_at := job_row.processing_expires_at;
    return next result_row;
    return;
  end if;

  if job_found and job_row.status = 'processing'
    and job_row.processing_expires_at > statement_timestamp() then
    if case_row.status <> 'checking' then
      result_row.outcome := 'case_not_ready';
      return next result_row;
      return;
    end if;

    result_row.outcome := case
      when job_row.processing_token = $3 then 'claimed'::public.total_loss_analysis_outcome
      else 'processing'::public.total_loss_analysis_outcome
    end;
    result_row.job_id := job_row.id;
    result_row.status := job_row.status;
    result_row.attempt_count := job_row.attempt_count;
    result_row.run_id := job_row.run_id;
    result_row.failure_code := job_row.failure_code;
    result_row.retryable := job_row.retryable;
    result_row.processing_expires_at := job_row.processing_expires_at;
    return next result_row;
    return;
  end if;

  if job_found and job_row.status = 'failed' and not job_row.retryable then
    result_row.outcome := 'failed';
    result_row.job_id := job_row.id;
    result_row.status := job_row.status;
    result_row.attempt_count := job_row.attempt_count;
    result_row.run_id := job_row.run_id;
    result_row.failure_code := job_row.failure_code;
    result_row.retryable := job_row.retryable;
    result_row.processing_expires_at := job_row.processing_expires_at;
    return next result_row;
    return;
  end if;

  if details_row.intake_mode <> 'report' then
    result_row.outcome := 'report_intake_required';
    return next result_row;
    return;
  end if;

  if details_row.intake_completed_at is null then
    result_row.outcome := 'intake_not_ready';
    return next result_row;
    return;
  end if;

  if normalized_postal_code is null then
    result_row.outcome := 'postal_code_required';
    return next result_row;
    return;
  end if;

  if normalized_postal_code !~ '^[0-9]{5}(-[0-9]{4})?$' then
    result_row.outcome := 'invalid_postal_code';
    return next result_row;
    return;
  end if;

  if details_row.report_upload_id is not null
    or details_row.report_last_upload_id is null
    or details_row.report_original_filename is null
    or details_row.report_uploaded_at is null then
    result_row.outcome := 'report_required';
    return next result_row;
    return;
  end if;

  if not exists (
    select 1
    from storage.objects as stored_object
    where stored_object.bucket_id = 'case-files'
      and stored_object.name = case_row.user_id::text || '/' || case_row.id::text
        || '/valuation-report.pdf'
      and stored_object.user_metadata ->> 'uploadId'
        = details_row.report_last_upload_id::text
  ) then
    result_row.outcome := 'report_required';
    return next result_row;
    return;
  end if;

  if (
    not job_found
    and case_row.status <> 'draft'
  ) or (
    job_found
    and job_row.status = 'processing'
    and case_row.status <> 'checking'
  ) or (
    job_found
    and job_row.status = 'failed'
    and case_row.status <> 'draft'
  ) then
    result_row.outcome := 'case_not_ready';
    return next result_row;
    return;
  end if;

  if job_found then
    update public.total_loss_analysis_jobs as analysis_job
    set
      source_details_updated_at = details_row.updated_at,
      status = 'processing',
      attempt_count = analysis_job.attempt_count + 1,
      processing_token = $3,
      processing_expires_at = statement_timestamp() + interval '2 hours',
      failure_code = null,
      retryable = null,
      finished_at = null
    where analysis_job.id = job_row.id
    returning analysis_job.* into job_row;
  else
    insert into public.total_loss_analysis_jobs (
      case_id,
      source_report_upload_id,
      source_details_updated_at,
      processing_token,
      processing_expires_at
    )
    values (
      $1,
      details_row.report_last_upload_id,
      details_row.updated_at,
      $3,
      statement_timestamp() + interval '2 hours'
    )
    returning * into job_row;
  end if;

  update public.appraisal_cases as appraisal_case
  set
    status = 'checking',
    last_activity_at = statement_timestamp()
  where appraisal_case.id = case_row.id;

  result_row.outcome := 'claimed';
  result_row.job_id := job_row.id;
  result_row.status := job_row.status;
  result_row.attempt_count := job_row.attempt_count;
  result_row.run_id := job_row.run_id;
  result_row.failure_code := job_row.failure_code;
  result_row.retryable := job_row.retryable;
  result_row.processing_expires_at := job_row.processing_expires_at;
  return next result_row;
end;
$$;

comment on function public.claim_total_loss_analysis(uuid, uuid, uuid) is
  'Claims or idempotently observes analysis for an owned, complete report intake; expired and retryable work keeps its reserved run ID.';

create function public.get_total_loss_analysis_status(
  case_id uuid,
  user_id uuid
)
returns setof public.total_loss_analysis_result
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  job_row public.total_loss_analysis_jobs%rowtype;
  result_row public.total_loss_analysis_result;
  current_report_upload_id uuid;
begin
  if $1 is null or $2 is null or not exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = $1
      and appraisal_case.user_id = $2
      and appraisal_case.service_type = 'total_loss'
  ) then
    result_row.outcome := 'not_found';
    return next result_row;
    return;
  end if;

  select nullif(btrim(details.postal_code), ''), details.report_last_upload_id
  into result_row.postal_code, current_report_upload_id
  from public.total_loss_case_details as details
  where details.case_id = $1;

  if current_report_upload_id is null then
    result_row.outcome := 'not_submitted';
    return next result_row;
    return;
  end if;

  select analysis_job.*
  into job_row
  from public.total_loss_analysis_jobs as analysis_job
  where analysis_job.case_id = $1
    and analysis_job.source_report_upload_id = current_report_upload_id;

  if not found then
    result_row.outcome := 'not_submitted';
    return next result_row;
    return;
  end if;

  result_row.outcome := job_row.status::text::public.total_loss_analysis_outcome;
  result_row.job_id := job_row.id;
  result_row.status := job_row.status;
  result_row.attempt_count := job_row.attempt_count;
  result_row.run_id := job_row.run_id;
  result_row.failure_code := job_row.failure_code;
  result_row.retryable := job_row.retryable;
  result_row.processing_expires_at := job_row.processing_expires_at;
  return next result_row;
end;
$$;

comment on function public.get_total_loss_analysis_status(uuid, uuid) is
  'Returns non-sensitive analysis status for the currently finalized report only after explicit trusted owner verification.';

create function public.complete_total_loss_analysis(
  job_id uuid,
  processing_token uuid,
  run_id uuid,
  artifact jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  job_row public.total_loss_analysis_jobs%rowtype;
  stored_artifact jsonb;
  request_digest_value text;
  search_digest_value text;
  schema_version_value text;
  analysis_version_value text;
  discrepancy_version_value text;
  scoring_version_value text;
begin
  if $1 is null or $2 is null or $3 is null or $4 is null then
    raise exception using
      errcode = '22023',
      message = 'Job, processing, run, and artifact values are required.';
  end if;

  select analysis_job.*
  into job_row
  from public.total_loss_analysis_jobs as analysis_job
  where analysis_job.id = $1
  for update;

  if not found then
    return false;
  end if;

  if job_row.status = 'completed' then
    select analysis_run.artifact
    into stored_artifact
    from public.analysis_runs as analysis_run
    where analysis_run.id = $3
      and analysis_run.job_id = job_row.id
      and analysis_run.case_id = job_row.case_id;

    return coalesce(
      job_row.processing_token = $2
        and job_row.run_id = $3
        and stored_artifact = $4,
      false
    );
  end if;

  if job_row.status <> 'processing'
    or job_row.processing_token <> $2
    or job_row.run_id <> $3 then
    return false;
  end if;

  request_digest_value := $4 ->> 'requestDigest';
  search_digest_value := $4 ->> 'searchDiagnosticsDigest';
  schema_version_value := $4 ->> 'analysisRunSchemaVersion';
  analysis_version_value := $4 ->> 'analysisVersion';
  discrepancy_version_value := $4 ->> 'discrepancyAnalysisVersion';
  scoring_version_value := $4 ->> 'comparableScoringVersion';

  if coalesce(jsonb_typeof($4), 'missing') <> 'object'
    or coalesce(jsonb_typeof($4 -> 'runId'), 'missing') <> 'string'
    or $4 ->> 'runId' <> $3::text
    or coalesce(jsonb_typeof($4 -> 'requestDigest'), 'missing') <> 'string'
    or coalesce(request_digest_value, '') !~ '^[0-9a-f]{64}$'
    or (
      $4 ? 'searchDiagnosticsDigest'
      and (
        coalesce(
          jsonb_typeof($4 -> 'searchDiagnosticsDigest'),
          'missing'
        ) <> 'string'
        or coalesce(search_digest_value, '') !~ '^[0-9a-f]{64}$'
      )
    )
    or coalesce(
      jsonb_typeof($4 -> 'analysisRunSchemaVersion'),
      'missing'
    ) <> 'string'
    or coalesce(schema_version_value, '') !~ '^[0-9]{1,16}$'
    or coalesce(jsonb_typeof($4 -> 'analysisVersion'), 'missing') <> 'string'
    or coalesce(analysis_version_value, '') !~ '^[0-9]{1,16}$'
    or coalesce(
      jsonb_typeof($4 -> 'discrepancyAnalysisVersion'),
      'missing'
    ) <> 'string'
    or coalesce(discrepancy_version_value, '') !~ '^[0-9]{1,16}$'
    or coalesce(
      jsonb_typeof($4 -> 'comparableScoringVersion'),
      'missing'
    ) <> 'string'
    or coalesce(scoring_version_value, '') !~ '^[0-9]{1,16}$' then
    raise exception using
      errcode = '22023',
      message = 'The analysis artifact metadata is invalid.';
  end if;

  insert into public.analysis_runs (
    id,
    job_id,
    case_id,
    artifact,
    request_digest,
    search_diagnostics_digest,
    analysis_run_schema_version,
    analysis_version,
    discrepancy_analysis_version,
    comparable_scoring_version
  )
  values (
    $3,
    job_row.id,
    job_row.case_id,
    $4,
    request_digest_value,
    search_digest_value,
    schema_version_value,
    analysis_version_value,
    discrepancy_version_value,
    scoring_version_value
  );

  update public.total_loss_analysis_jobs as analysis_job
  set
    status = 'completed',
    processing_expires_at = null,
    failure_code = null,
    retryable = null,
    finished_at = statement_timestamp()
  where analysis_job.id = job_row.id;

  update public.appraisal_cases as appraisal_case
  set
    status = 'check_complete',
    last_activity_at = statement_timestamp()
  where appraisal_case.id = job_row.case_id
    and appraisal_case.status = 'checking';

  if not found then
    raise exception using
      errcode = '55000',
      message = 'The analysis case is no longer in the checking state.';
  end if;

  return true;
end;
$$;

comment on function public.complete_total_loss_analysis(uuid, uuid, uuid, jsonb) is
  'Atomically persists the reserved immutable run and completes its job and case; an exact terminal replay is idempotent.';

create function public.fail_total_loss_analysis(
  job_id uuid,
  processing_token uuid,
  failure_code text,
  retryable boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  job_row public.total_loss_analysis_jobs%rowtype;
begin
  if $1 is null or $2 is null or $3 is null or $4 is null
    or $3 !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception using
      errcode = '22023',
      message = 'A safe failure code and complete failure transition are required.';
  end if;

  select analysis_job.*
  into job_row
  from public.total_loss_analysis_jobs as analysis_job
  where analysis_job.id = $1
  for update;

  if not found then
    return false;
  end if;

  if job_row.status = 'failed' then
    return job_row.processing_token = $2
      and job_row.failure_code = $3
      and job_row.retryable = $4;
  end if;

  if job_row.status <> 'processing'
    or job_row.processing_token <> $2 then
    return false;
  end if;

  update public.total_loss_analysis_jobs as analysis_job
  set
    status = 'failed',
    processing_expires_at = null,
    failure_code = $3,
    retryable = $4,
    finished_at = statement_timestamp()
  where analysis_job.id = job_row.id;

  update public.appraisal_cases as appraisal_case
  set
    status = 'draft',
    last_activity_at = statement_timestamp()
  where appraisal_case.id = job_row.case_id
    and appraisal_case.status = 'checking';

  if not found then
    raise exception using
      errcode = '55000',
      message = 'The analysis case is no longer in the checking state.';
  end if;

  return true;
end;
$$;

comment on function public.fail_total_loss_analysis(uuid, uuid, text, boolean) is
  'Records only a safe failure code, releases the case to draft, and preserves the reserved run ID for a retryable claim.';

create function public.get_owned_analysis_run(
  run_id uuid,
  user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select analysis_run.artifact
  from public.analysis_runs as analysis_run
  join public.total_loss_analysis_jobs as analysis_job
    on analysis_job.id = analysis_run.job_id
    and analysis_job.case_id = analysis_run.case_id
    and analysis_job.run_id = analysis_run.id
  join public.appraisal_cases as appraisal_case
    on appraisal_case.id = analysis_run.case_id
  where analysis_run.id = $1
    and appraisal_case.user_id = $2
    and appraisal_case.service_type = 'total_loss'
    and analysis_job.status = 'completed';
$$;

comment on function public.get_owned_analysis_run(uuid, uuid) is
  'Returns a raw audit artifact only to the trusted backend after explicit case-owner verification.';

revoke execute on function public.claim_total_loss_analysis(uuid, uuid, uuid) from public;
revoke execute on function public.get_total_loss_analysis_status(uuid, uuid) from public;
revoke execute on function public.complete_total_loss_analysis(uuid, uuid, uuid, jsonb) from public;
revoke execute on function public.fail_total_loss_analysis(uuid, uuid, text, boolean) from public;
revoke execute on function public.get_owned_analysis_run(uuid, uuid) from public;

revoke execute on function public.claim_total_loss_analysis(uuid, uuid, uuid) from anon;
revoke execute on function public.get_total_loss_analysis_status(uuid, uuid) from anon;
revoke execute on function public.complete_total_loss_analysis(uuid, uuid, uuid, jsonb) from anon;
revoke execute on function public.fail_total_loss_analysis(uuid, uuid, text, boolean) from anon;
revoke execute on function public.get_owned_analysis_run(uuid, uuid) from anon;

revoke execute on function public.claim_total_loss_analysis(uuid, uuid, uuid) from authenticated;
revoke execute on function public.get_total_loss_analysis_status(uuid, uuid) from authenticated;
revoke execute on function public.complete_total_loss_analysis(uuid, uuid, uuid, jsonb) from authenticated;
revoke execute on function public.fail_total_loss_analysis(uuid, uuid, text, boolean) from authenticated;
revoke execute on function public.get_owned_analysis_run(uuid, uuid) from authenticated;

grant execute on function public.claim_total_loss_analysis(uuid, uuid, uuid) to service_role;
grant execute on function public.get_total_loss_analysis_status(uuid, uuid) to service_role;
grant execute on function public.complete_total_loss_analysis(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.fail_total_loss_analysis(uuid, uuid, text, boolean) to service_role;
grant execute on function public.get_owned_analysis_run(uuid, uuid) to service_role;

drop policy if exists "Customers can create their own total-loss details"
on public.total_loss_case_details;

create policy "Customers can create their own total-loss details"
on public.total_loss_case_details
for insert
to authenticated
with check (
  exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = total_loss_case_details.case_id
      and appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'total_loss'
      and appraisal_case.status = 'draft'
  )
);

comment on policy "Customers can create their own total-loss details"
on public.total_loss_case_details is
  'A customer can attach details only to an owned draft total-loss case.';

drop policy if exists "Customers can update their own total-loss details"
on public.total_loss_case_details;

create policy "Customers can update their own total-loss details"
on public.total_loss_case_details
for update
to authenticated
using (
  exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = total_loss_case_details.case_id
      and appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'total_loss'
      and appraisal_case.status = 'draft'
  )
)
with check (
  exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = total_loss_case_details.case_id
      and appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'total_loss'
      and appraisal_case.status = 'draft'
  )
);

comment on policy "Customers can update their own total-loss details"
on public.total_loss_case_details is
  'Customer intake is mutable only while its owned total-loss parent remains draft.';

create or replace function public.authorize_total_loss_report_backup_delete(
  object_name text,
  object_user_metadata jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.total_loss_case_details as details
    join public.appraisal_cases as appraisal_case
      on appraisal_case.id = details.case_id
    where appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'total_loss'
      and appraisal_case.status = 'draft'
      and details.report_upload_id is null
      and $1 = appraisal_case.user_id::text || '/' || details.case_id::text
        || '/valuation-report-backup.pdf'
      and $2 ->> 'uploadId' in (
        details.report_last_upload_id::text,
        details.report_last_cancelled_upload_id::text
      )
  );
$$;

comment on function public.authorize_total_loss_report_backup_delete(text, jsonb) is
  'Permits finalized or cancelled backup cleanup only while the owned total-loss case remains draft.';

revoke execute on function public.authorize_total_loss_report_backup_delete(text, jsonb) from public;
revoke execute on function public.authorize_total_loss_report_backup_delete(text, jsonb) from anon;
grant execute on function public.authorize_total_loss_report_backup_delete(text, jsonb)
to authenticated, service_role;
