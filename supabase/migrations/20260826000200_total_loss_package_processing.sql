-- Milestone 4: durable paid-package processing and deterministic assessment.
--
-- The commerce transaction remains authoritative for entitlement creation. This
-- migration adds the next, deliberately separate, service-only boundary:
-- entitlement -> package job + durable work item -> frozen source -> assessment.

alter table public.total_loss_package_jobs
  add constraint total_loss_package_jobs_full_identity_key
  unique (id, case_id, preliminary_snapshot_id, entitlement_id);

alter table public.total_loss_package_jobs
  drop constraint total_loss_package_jobs_status_valid,
  drop constraint total_loss_package_jobs_state_complete;

alter table public.total_loss_package_jobs
  add constraint total_loss_package_jobs_status_valid
  check (
    status in (
      'queued',
      'processing',
      'source_frozen',
      'assessment_ready',
      'review_required',
      'new_evidence_required',
      'retryable_failed',
      'failed',
      -- Dormant Milestone 1 states remain valid for backward compatibility.
      'waiting_ai_review',
      'waiting_human_review',
      'ready',
      'not_supportable'
    )
  ),
  add constraint total_loss_package_jobs_state_complete
  check (
    (
      status = 'queued'
      and attempt_count = 0
      and processing_token is null
      and processing_expires_at is null
      and failure_code is null
      and retryable is null
      and started_at is null
      and finished_at is null
    )
    or (
      status in ('processing', 'source_frozen')
      and attempt_count >= 1
      and processing_token is not null
      and processing_expires_at is not null
      and failure_code is null
      and retryable is null
      and started_at is not null
      and finished_at is null
    )
    or (
      status in ('waiting_ai_review', 'waiting_human_review')
      and attempt_count >= 1
      and processing_token is not null
      and processing_expires_at is null
      and failure_code is null
      and retryable is null
      and started_at is not null
      and finished_at is null
    )
    or (
      status in ('assessment_ready', 'ready', 'not_supportable')
      and attempt_count >= 1
      and processing_token is not null
      and processing_expires_at is null
      and failure_code is null
      and retryable is null
      and started_at is not null
      and finished_at is not null
    )
    or (
      status in ('review_required', 'new_evidence_required')
      and attempt_count >= 1
      and processing_token is not null
      and processing_expires_at is null
      and failure_code is not null
      and retryable = false
      and started_at is not null
      and finished_at is not null
    )
    or (
      status = 'retryable_failed'
      and attempt_count >= 1
      and processing_token is not null
      and processing_expires_at is null
      and failure_code is not null
      and retryable = true
      and started_at is not null
      and finished_at is not null
    )
    or (
      status = 'failed'
      and attempt_count >= 1
      and processing_token is not null
      and processing_expires_at is null
      and failure_code is not null
      and retryable = false
      and started_at is not null
      and finished_at is not null
    )
  );

drop index public.total_loss_package_jobs_one_processing_per_case_idx;
create unique index total_loss_package_jobs_one_processing_per_case_idx
  on public.total_loss_package_jobs (case_id)
  where status in ('processing', 'source_frozen');

create table public.workflow_work_items (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  package_job_id uuid not null,
  work_type text not null,
  work_version text not null,
  status text not null default 'queued',
  dispatch_attempt_count integer not null default 0,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default statement_timestamp(),
  dispatch_token uuid,
  dispatch_expires_at timestamptz,
  processing_token uuid,
  processing_expires_at timestamptz,
  last_dispatched_at timestamptz,
  last_error_code text,
  retryable boolean,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint workflow_work_items_id_case_key unique (id, case_id),
  constraint workflow_work_items_package_identity_key
    unique (id, package_job_id, case_id),
  constraint workflow_work_items_logical_key
    unique (package_job_id, work_type, work_version),
  constraint workflow_work_items_package_case_fkey
    foreign key (package_job_id, case_id)
    references public.total_loss_package_jobs (id, case_id)
    on delete restrict,
  constraint workflow_work_items_codes_safe
    check (
      work_type ~ '^[a-z][a-z0-9_.-]{0,127}$'
      and work_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and (
        last_error_code is null
        or last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
      )
    ),
  constraint workflow_work_items_status_valid
    check (
      status in (
        'queued',
        'dispatching',
        'processing',
        'completed',
        'retryable_failed',
        'terminal_failed'
      )
    ),
  constraint workflow_work_items_attempts_valid
    check (dispatch_attempt_count >= 0 and attempt_count >= 0),
  constraint workflow_work_items_state_complete
    check (
      (
        status = 'queued'
        and dispatch_token is null
        and dispatch_expires_at is null
        and processing_token is null
        and processing_expires_at is null
        and retryable is null
        and completed_at is null
        and failed_at is null
      )
      or (
        status = 'dispatching'
        and dispatch_attempt_count >= 1
        and dispatch_token is not null
        and dispatch_expires_at is not null
        and processing_token is null
        and processing_expires_at is null
        and retryable is null
        and completed_at is null
        and failed_at is null
      )
      or (
        status = 'processing'
        and attempt_count >= 1
        and dispatch_token is null
        and dispatch_expires_at is null
        and processing_token is not null
        and processing_expires_at is not null
        and last_error_code is null
        and retryable is null
        and completed_at is null
        and failed_at is null
      )
      or (
        status = 'completed'
        and attempt_count >= 1
        and dispatch_token is null
        and dispatch_expires_at is null
        and processing_token is not null
        and processing_expires_at is null
        and last_error_code is null
        and retryable is null
        and completed_at is not null
        and failed_at is null
      )
      or (
        status = 'retryable_failed'
        and attempt_count >= 1
        and dispatch_token is null
        and dispatch_expires_at is null
        and processing_token is not null
        and processing_expires_at is null
        and last_error_code is not null
        and retryable = true
        and completed_at is null
        and failed_at is not null
      )
      or (
        status = 'terminal_failed'
        and attempt_count >= 1
        and dispatch_token is null
        and dispatch_expires_at is null
        and processing_token is not null
        and processing_expires_at is null
        and last_error_code is not null
        and retryable = false
        and completed_at is null
        and failed_at is not null
      )
    )
);

comment on table public.workflow_work_items is
  'Private durable outbox and execution lease for post-purchase workflow work; Cloud task payloads contain only this opaque ID.';
comment on column public.workflow_work_items.last_error_code is
  'Bounded operational code only; provider messages, source content, prompts, and customer facts are prohibited.';

create index workflow_work_items_due_idx
  on public.workflow_work_items (
    status,
    next_attempt_at,
    dispatch_expires_at,
    processing_expires_at,
    created_at
  );
create index workflow_work_items_case_created_idx
  on public.workflow_work_items (case_id, created_at desc);

create trigger workflow_work_items_set_updated_at
before update on public.workflow_work_items
for each row execute function public.set_updated_at();

create trigger workflow_work_items_protect_identity
before update on public.workflow_work_items
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'package_job_id',
  'work_type',
  'work_version',
  'created_at'
);

create trigger workflow_work_items_protect_terminal
before update or delete on public.workflow_work_items
for each row execute function public.protect_total_loss_terminal_record(
  'completed',
  'terminal_failed'
);

create table public.total_loss_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  package_job_id uuid not null,
  entitlement_id uuid not null,
  preliminary_snapshot_id uuid not null,
  analysis_job_id uuid not null,
  analysis_run_id uuid not null references public.analysis_runs (id) on delete restrict,
  owner_user_id_at_creation uuid not null references auth.users (id) on delete restrict,
  source_intake_mode public.total_loss_intake_mode not null,
  source_report_upload_id uuid,
  source_analysis_input_revision bigint not null,
  source_analysis_input_id uuid,
  source_document_bucket_id text,
  source_document_object_name text,
  source_document_media_type text,
  source_document_byte_size bigint,
  source_document_sha256 text,
  extraction_available boolean not null,
  extraction_provider_name text,
  extraction_model_identifier text,
  extraction_schema_version text,
  normalized_extraction_digest text,
  analysis_artifact_digest text not null,
  preliminary_snapshot_digest text not null,
  request_digest text not null,
  search_diagnostics_digest text,
  evidence_cutoff date not null,
  snapshot_created_at timestamptz not null,
  analysis_run_schema_version text not null,
  analysis_version text not null,
  discrepancy_analysis_version text not null,
  comparable_scoring_version text not null,
  presentation_schema_version text not null,
  preliminary_snapshot_schema_version text not null,
  snapshot_schema_version text not null,
  source_snapshot jsonb not null,
  snapshot_digest text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint total_loss_source_snapshots_id_case_key unique (id, case_id),
  constraint total_loss_source_snapshots_package_key unique (package_job_id),
  constraint total_loss_source_snapshots_lineage_identity_key
    unique (id, package_job_id, case_id, preliminary_snapshot_id),
  constraint total_loss_source_snapshots_package_identity_fkey
    foreign key (
      package_job_id,
      case_id,
      preliminary_snapshot_id,
      entitlement_id
    ) references public.total_loss_package_jobs (
      id,
      case_id,
      preliminary_snapshot_id,
      entitlement_id
    ) on delete restrict,
  constraint total_loss_source_snapshots_entitlement_identity_fkey
    foreign key (entitlement_id, case_id, preliminary_snapshot_id)
    references public.case_entitlements (id, case_id, preliminary_snapshot_id)
    on delete restrict,
  constraint total_loss_source_snapshots_preliminary_case_fkey
    foreign key (preliminary_snapshot_id, case_id)
    references public.total_loss_preliminary_snapshots (id, case_id)
    on delete restrict,
  constraint total_loss_source_snapshots_run_identity_fkey
    foreign key (analysis_run_id, analysis_job_id, case_id)
    references public.total_loss_analysis_jobs (run_id, id, case_id)
    on delete restrict,
  constraint total_loss_source_snapshots_revision_positive
    check (source_analysis_input_revision >= 1),
  constraint total_loss_source_snapshots_document_complete
    check (
      (
        source_intake_mode = 'report'
        and source_report_upload_id is not null
        and source_document_bucket_id = 'case-files'
        and char_length(source_document_object_name) between 1 and 1024
        and char_length(source_document_media_type) between 1 and 255
        and source_document_byte_size > 0
        and source_document_sha256 ~ '^[0-9a-f]{64}$'
      )
      or (
        source_intake_mode = 'manual'
        and source_report_upload_id is null
        and source_document_bucket_id is null
        and source_document_object_name is null
        and source_document_media_type is null
        and source_document_byte_size is null
        and source_document_sha256 is null
      )
    ),
  constraint total_loss_source_snapshots_extraction_complete
    check (
      (
        extraction_available
        and source_intake_mode = 'report'
        and extraction_schema_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
        and normalized_extraction_digest ~ '^[0-9a-f]{64}$'
      )
      or (
        not extraction_available
        and extraction_provider_name is null
        and extraction_model_identifier is null
        and extraction_schema_version is null
        and normalized_extraction_digest is null
      )
    ),
  constraint total_loss_source_snapshots_extraction_text_safe
    check (
      (
        extraction_provider_name is null
        or (
          char_length(btrim(extraction_provider_name)) between 1 and 200
          and extraction_provider_name !~ '[[:cntrl:]]'
        )
      )
      and (
        extraction_model_identifier is null
        or (
          char_length(btrim(extraction_model_identifier)) between 1 and 255
          and extraction_model_identifier !~ '[[:cntrl:]]'
        )
      )
    ),
  constraint total_loss_source_snapshots_digests_valid
    check (
      analysis_artifact_digest ~ '^[0-9a-f]{64}$'
      and preliminary_snapshot_digest ~ '^[0-9a-f]{64}$'
      and request_digest ~ '^[0-9a-f]{64}$'
      and (
        search_diagnostics_digest is null
        or search_diagnostics_digest ~ '^[0-9a-f]{64}$'
      )
      and snapshot_digest ~ '^[0-9a-f]{64}$'
    ),
  constraint total_loss_source_snapshots_versions_safe
    check (
      analysis_run_schema_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and analysis_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and discrepancy_analysis_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and comparable_scoring_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and presentation_schema_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and preliminary_snapshot_schema_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      and snapshot_schema_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    ),
  constraint total_loss_source_snapshots_snapshot_object
    check (
      jsonb_typeof(source_snapshot) = 'object'
      and pg_column_size(source_snapshot) <= 4194304
    )
);

comment on table public.total_loss_source_snapshots is
  'Immutable commercial freeze of the exact preliminary snapshot, analysis artifact, normalized extraction, source-document integrity, and provenance used for one paid package.';
comment on column public.total_loss_source_snapshots.source_document_object_name is
  'Private service-only case-files locator; it is never included in customer projections or task payloads.';

create index total_loss_source_snapshots_case_created_idx
  on public.total_loss_source_snapshots (case_id, created_at desc);

create trigger total_loss_source_snapshots_reject_mutation
before update or delete on public.total_loss_source_snapshots
for each row execute function public.reject_total_loss_immutable_record();

alter table public.total_loss_final_assessments
  add column source_snapshot_id uuid,
  add constraint total_loss_final_assessments_source_identity_fkey
    foreign key (
      source_snapshot_id,
      package_job_id,
      case_id,
      preliminary_snapshot_id
    ) references public.total_loss_source_snapshots (
      id,
      package_job_id,
      case_id,
      preliminary_snapshot_id
    ) on delete restrict;

comment on column public.total_loss_final_assessments.source_snapshot_id is
  'Milestone 4 source lineage. Nullable only for backward-compatible dormant foundation fixtures; the package persistence RPC always requires it.';

create unique index total_loss_final_assessments_m4_package_job_key
  on public.total_loss_final_assessments (package_job_id)
  where source_snapshot_id is not null;

alter table public.workflow_work_items enable row level security;
alter table public.total_loss_source_snapshots enable row level security;

revoke all on table public.workflow_work_items
  from public, anon, authenticated, service_role;
revoke all on table public.total_loss_source_snapshots
  from public, anon, authenticated, service_role;

grant select on table
  public.workflow_work_items,
  public.total_loss_source_snapshots
to service_role;

-- Existing dormant foundation grants remain backward compatible. The active M4
-- worker uses only the fenced RPC surface below; browser grants and policies are
-- unchanged, while the two newly introduced orchestration tables are read-only
-- even to service_role outside these SECURITY DEFINER functions.

create function public.enqueue_total_loss_package_job(
  requested_entitlement_id uuid
)
returns table (
  outcome text,
  case_id uuid,
  entitlement_id uuid,
  package_job_id uuid,
  work_item_id uuid,
  package_status text,
  work_item_status text,
  workflow_revision bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  entitlement_row public.case_entitlements%rowtype;
  order_row public.commerce_orders%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  snapshot_row public.total_loss_preliminary_snapshots%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  work_row public.workflow_work_items%rowtype;
  created_package boolean := false;
begin
  if requested_entitlement_id is null then
    raise exception using errcode = '22023', message = 'Entitlement identifier is required.';
  end if;

  select entitlement.*
  into entitlement_row
  from public.case_entitlements as entitlement
  where entitlement.id = requested_entitlement_id;

  if not found then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(entitlement_row.case_id::text)
  );

  select entitlement.*
  into entitlement_row
  from public.case_entitlements as entitlement
  where entitlement.id = requested_entitlement_id
  for update;

  select commerce_order.*
  into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.id = entitlement_row.order_id
    and commerce_order.case_id = entitlement_row.case_id
  for update;

  select workflow.*
  into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = entitlement_row.case_id
  for update;

  select snapshot.*
  into snapshot_row
  from public.total_loss_preliminary_snapshots as snapshot
  where snapshot.id = entitlement_row.preliminary_snapshot_id
    and snapshot.case_id = entitlement_row.case_id;

  if order_row.id is null
    or workflow_row.case_id is null
    or snapshot_row.id is null
    or workflow_row.preliminary_snapshot_id is distinct from snapshot_row.id
    or entitlement_row.product_identifier is distinct from order_row.product_identifier
    or entitlement_row.product_version is distinct from order_row.product_version
    or entitlement_row.preliminary_snapshot_id is distinct from order_row.preliminary_snapshot_id
    or not (
      (
        entitlement_row.status = 'active'
        and order_row.status in ('paid', 'partially_refunded')
      )
      or (
        entitlement_row.status = 'refunded_access_retained'
        and order_row.status = 'refunded'
      )
    )
    or not exists (
      select 1
      from public.appraisal_cases as appraisal_case
      join auth.users as auth_user on auth_user.id = appraisal_case.user_id
      where appraisal_case.id = entitlement_row.case_id
        and appraisal_case.service_type = 'total_loss'
        and appraisal_case.user_id = order_row.purchaser_user_id
        and not coalesce(auth_user.is_anonymous, false)
        and auth_user.email_confirmed_at is not null
    )
    or not exists (
      select 1
      from public.total_loss_analysis_jobs as analysis_job
      join public.analysis_runs as analysis_run
        on analysis_run.id = analysis_job.run_id
        and analysis_run.job_id = analysis_job.id
        and analysis_run.case_id = analysis_job.case_id
      where analysis_job.id = snapshot_row.analysis_job_id
        and analysis_job.run_id = snapshot_row.analysis_run_id
        and analysis_job.case_id = snapshot_row.case_id
        and analysis_job.status = 'completed'
        and analysis_job.source_intake_mode = snapshot_row.source_intake_mode
        and analysis_job.source_report_upload_id is not distinct from
          snapshot_row.source_report_upload_id
        and analysis_job.source_analysis_input_revision =
          snapshot_row.source_analysis_input_revision
        and analysis_job.source_analysis_input_id is not distinct from
          snapshot_row.source_analysis_input_id
    )
  then
    raise exception using
      errcode = '55000',
      message = 'Entitlement is not eligible for package processing.';
  end if;

  select package_job.*
  into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.entitlement_id = entitlement_row.id
    and package_job.preliminary_snapshot_id = entitlement_row.preliminary_snapshot_id
  for update;

  if not found then
    if workflow_row.phase <> 'review'
      or workflow_row.current_task <> 'purchase_complete'
      or workflow_row.current_package_job_id is not null then
      raise exception using
        errcode = '55000',
        message = 'Claim workflow is not at the package-creation boundary.';
    end if;

    insert into public.total_loss_package_jobs (
      case_id,
      entitlement_id,
      preliminary_snapshot_id,
      status
    ) values (
      entitlement_row.case_id,
      entitlement_row.id,
      entitlement_row.preliminary_snapshot_id,
      'queued'
    )
    returning * into package_row;
    created_package := true;
  elsif package_row.case_id is distinct from entitlement_row.case_id then
    raise exception using errcode = '55000', message = 'Package job lineage conflicts with entitlement.';
  end if;

  insert into public.workflow_work_items (
    case_id,
    package_job_id,
    work_type,
    work_version,
    status,
    next_attempt_at
  ) values (
    entitlement_row.case_id,
    package_row.id,
    'total_loss_package_finalize',
    '1',
    'queued',
    statement_timestamp()
  )
  on conflict on constraint workflow_work_items_logical_key do nothing;

  select work_item.*
  into work_row
  from public.workflow_work_items as work_item
  where work_item.package_job_id = package_row.id
    and work_item.work_type = 'total_loss_package_finalize'
    and work_item.work_version = '1'
  for update;

  if workflow_row.current_package_job_id is null
    and workflow_row.phase = 'review'
    and workflow_row.current_task = 'purchase_complete' then
    update public.total_loss_claim_workflows as workflow
    set
      current_package_job_id = package_row.id,
      current_task = 'package_queued',
      revision = workflow.revision + 1
    where workflow.case_id = workflow_row.case_id
    returning * into workflow_row;
  elsif workflow_row.current_package_job_id is distinct from package_row.id then
    raise exception using errcode = '55000', message = 'Claim workflow points to another package job.';
  end if;

  return query select
    case when created_package then 'created' else 'existing' end,
    package_row.case_id,
    package_row.entitlement_id,
    package_row.id,
    work_row.id,
    package_row.status,
    work_row.status,
    workflow_row.revision;
end;
$$;

comment on function public.enqueue_total_loss_package_job(uuid) is
  'Atomically creates or returns one package job and one durable work item for an eligible entitlement, then advances only the dedicated claim workflow.';

create function public.reserve_due_workflow_work_items(
  requested_dispatch_token uuid,
  requested_limit integer
)
returns table (
  work_item_id uuid,
  package_job_id uuid,
  work_type text,
  work_version text,
  dispatch_attempt_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if requested_dispatch_token is null
    or requested_limit is null
    or requested_limit < 1
    or requested_limit > 100 then
    raise exception using errcode = '22023', message = 'Dispatch reservation is invalid.';
  end if;

  return query
  with due as (
    select work_item.id
    from public.workflow_work_items as work_item
    where (
      work_item.status in ('queued', 'retryable_failed')
      and work_item.next_attempt_at <= statement_timestamp()
    ) or (
      work_item.status = 'dispatching'
      and work_item.dispatch_expires_at <= statement_timestamp()
    ) or (
      work_item.status = 'processing'
      and work_item.processing_expires_at <= statement_timestamp()
    )
    order by work_item.next_attempt_at, work_item.created_at, work_item.id
    for update skip locked
    limit requested_limit
  ), reserved as (
    update public.workflow_work_items as work_item
    set
      status = 'dispatching',
      dispatch_attempt_count = work_item.dispatch_attempt_count + 1,
      dispatch_token = requested_dispatch_token,
      dispatch_expires_at = statement_timestamp() + interval '5 minutes',
      processing_token = null,
      processing_expires_at = null,
      retryable = null,
      completed_at = null,
      failed_at = null,
      last_error_code = case
        when work_item.status = 'processing' then 'WORK_LEASE_EXPIRED'
        else work_item.last_error_code
      end
    from due
    where work_item.id = due.id
    returning work_item.*
  )
  select
    reserved.id,
    reserved.package_job_id,
    reserved.work_type,
    reserved.work_version,
    reserved.dispatch_attempt_count
  from reserved;
end;
$$;

comment on function public.reserve_due_workflow_work_items(uuid, integer) is
  'Claims a bounded due-work batch under a short dispatcher lease; expired execution leases are fenced before redispatch.';

create function public.reconcile_total_loss_package_work_items(
  requested_dispatch_token uuid,
  requested_limit integer
)
returns table (
  work_item_id uuid,
  package_job_id uuid,
  work_type text,
  work_version text,
  dispatch_attempt_count integer
)
language sql
volatile
security definer
set search_path = ''
as $$
  select *
  from public.reserve_due_workflow_work_items($1, $2);
$$;

comment on function public.reconcile_total_loss_package_work_items(uuid, integer) is
  'Bounded reconciliation entry point for queued, retryable, and lease-stranded package work.';

create function public.mark_workflow_work_item_dispatched(
  requested_work_item_id uuid,
  requested_dispatch_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if requested_work_item_id is null or requested_dispatch_token is null then
    raise exception using errcode = '22023', message = 'Dispatch completion identifiers are required.';
  end if;

  update public.workflow_work_items as work_item
  set
    status = 'queued',
    dispatch_token = null,
    dispatch_expires_at = null,
    last_dispatched_at = statement_timestamp(),
    last_error_code = null,
    next_attempt_at = statement_timestamp() + interval '5 minutes'
  where work_item.id = requested_work_item_id
    and work_item.status = 'dispatching'
    and work_item.dispatch_token = requested_dispatch_token
    and work_item.dispatch_expires_at > statement_timestamp();

  if found then
    return true;
  end if;

  return exists (
    select 1
    from public.workflow_work_items as work_item
    where work_item.id = requested_work_item_id
      and work_item.status in ('processing', 'completed')
  );
end;
$$;

create function public.release_workflow_work_item_dispatch(
  requested_work_item_id uuid,
  requested_dispatch_token uuid,
  requested_error_code text,
  requested_delay_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if requested_work_item_id is null
    or requested_dispatch_token is null
    or requested_error_code is null
    or requested_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    or requested_delay_seconds is null
    or requested_delay_seconds < 1
    or requested_delay_seconds > 3600 then
    raise exception using errcode = '22023', message = 'Dispatch failure is invalid.';
  end if;

  update public.workflow_work_items as work_item
  set
    status = 'queued',
    dispatch_token = null,
    dispatch_expires_at = null,
    last_error_code = requested_error_code,
    next_attempt_at = statement_timestamp()
      + pg_catalog.make_interval(secs => requested_delay_seconds)
  where work_item.id = requested_work_item_id
    and work_item.status = 'dispatching'
    and work_item.dispatch_token = requested_dispatch_token;

  return found;
end;
$$;

create function public.claim_total_loss_package_work_item(
  requested_work_item_id uuid,
  requested_processing_token uuid
)
returns table (
  outcome text,
  case_id uuid,
  package_job_id uuid,
  work_item_id uuid,
  package_status text,
  work_item_status text,
  attempt_count integer,
  processing_token uuid,
  processing_expires_at timestamptz,
  source_snapshot_id uuid,
  final_assessment_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  work_row public.workflow_work_items%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  order_row public.commerce_orders%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  source_id uuid;
  assessment_id uuid;
  lease_expires_at timestamptz := statement_timestamp() + interval '30 minutes';
  processable boolean;
begin
  if requested_work_item_id is null or requested_processing_token is null then
    raise exception using errcode = '22023', message = 'Work item and processing token are required.';
  end if;

  select work_item.*
  into work_row
  from public.workflow_work_items as work_item
  where work_item.id = requested_work_item_id
  for update;

  if not found then
    return;
  end if;

  select package_job.*
  into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = work_row.package_job_id
    and package_job.case_id = work_row.case_id
  for update;

  select source_snapshot.id
  into source_id
  from public.total_loss_source_snapshots as source_snapshot
  where source_snapshot.package_job_id = package_row.id;

  select final_assessment.id
  into assessment_id
  from public.total_loss_final_assessments as final_assessment
  where final_assessment.package_job_id = package_row.id;

  if work_row.status = 'completed' then
    return query select
      'completed'::text,
      package_row.case_id,
      package_row.id,
      work_row.id,
      package_row.status,
      work_row.status,
      work_row.attempt_count,
      work_row.processing_token,
      work_row.processing_expires_at,
      source_id,
      assessment_id;
    return;
  end if;

  if work_row.status = 'terminal_failed' then
    return query select
      'terminal_failed'::text,
      package_row.case_id,
      package_row.id,
      work_row.id,
      package_row.status,
      work_row.status,
      work_row.attempt_count,
      work_row.processing_token,
      work_row.processing_expires_at,
      source_id,
      assessment_id;
    return;
  end if;

  if work_row.status = 'processing'
    and work_row.processing_expires_at > statement_timestamp() then
    return query select
      case
        when work_row.processing_token = requested_processing_token
          then 'claimed'::text
        else 'busy'::text
      end,
      package_row.case_id,
      package_row.id,
      work_row.id,
      package_row.status,
      work_row.status,
      work_row.attempt_count,
      work_row.processing_token,
      work_row.processing_expires_at,
      source_id,
      assessment_id;
    return;
  end if;

  if work_row.status not in (
    'queued',
    'dispatching',
    'retryable_failed',
    'processing'
  ) then
    raise exception using errcode = '55000', message = 'Work item cannot be claimed from its current state.';
  end if;

  select entitlement.*
  into entitlement_row
  from public.case_entitlements as entitlement
  where entitlement.id = package_row.entitlement_id
    and entitlement.case_id = package_row.case_id
  for update;

  select commerce_order.*
  into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.id = entitlement_row.order_id
    and commerce_order.case_id = entitlement_row.case_id
  for update;

  select workflow.*
  into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = package_row.case_id
  for update;

  processable := entitlement_row.id is not null
    and order_row.id is not null
    and workflow_row.case_id is not null
    and workflow_row.current_package_job_id = package_row.id
    and workflow_row.preliminary_snapshot_id = package_row.preliminary_snapshot_id
    and workflow_row.phase = 'review'
    and (
      (
        entitlement_row.status = 'active'
        and order_row.status in ('paid', 'partially_refunded')
      )
      or (
        entitlement_row.status = 'refunded_access_retained'
        and order_row.status = 'refunded'
      )
    );

  if not processable then
    update public.workflow_work_items as work_item
    set
      status = 'terminal_failed',
      attempt_count = work_item.attempt_count + 1,
      dispatch_token = null,
      dispatch_expires_at = null,
      processing_token = requested_processing_token,
      processing_expires_at = null,
      last_error_code = 'ENTITLEMENT_UNAVAILABLE',
      retryable = false,
      completed_at = null,
      failed_at = statement_timestamp()
    where work_item.id = work_row.id
    returning * into work_row;

    update public.total_loss_package_jobs as package_job
    set
      status = 'failed',
      attempt_count = package_job.attempt_count + 1,
      processing_token = requested_processing_token,
      processing_expires_at = null,
      failure_code = 'ENTITLEMENT_UNAVAILABLE',
      retryable = false,
      started_at = coalesce(package_job.started_at, statement_timestamp()),
      finished_at = statement_timestamp()
    where package_job.id = package_row.id
    returning * into package_row;

    if workflow_row.case_id is not null
      and workflow_row.current_package_job_id = package_row.id then
      update public.total_loss_claim_workflows as workflow
      set
        current_task = 'package_unavailable',
        revision = workflow.revision + 1
      where workflow.case_id = workflow_row.case_id;
    end if;

    return query select
      'terminal_failed'::text,
      package_row.case_id,
      package_row.id,
      work_row.id,
      package_row.status,
      work_row.status,
      work_row.attempt_count,
      work_row.processing_token,
      work_row.processing_expires_at,
      source_id,
      assessment_id;
    return;
  end if;

  update public.workflow_work_items as work_item
  set
    status = 'processing',
    attempt_count = work_item.attempt_count + 1,
    dispatch_token = null,
    dispatch_expires_at = null,
    processing_token = requested_processing_token,
    processing_expires_at = lease_expires_at,
    last_error_code = null,
    retryable = null,
    completed_at = null,
    failed_at = null
  where work_item.id = work_row.id
  returning * into work_row;

  update public.total_loss_package_jobs as package_job
  set
    status = case when source_id is null then 'processing' else 'source_frozen' end,
    attempt_count = package_job.attempt_count + 1,
    processing_token = requested_processing_token,
    processing_expires_at = lease_expires_at,
    failure_code = null,
    retryable = null,
    started_at = coalesce(package_job.started_at, statement_timestamp()),
    finished_at = null
  where package_job.id = package_row.id
  returning * into package_row;

  return query select
    'claimed'::text,
    package_row.case_id,
    package_row.id,
    work_row.id,
    package_row.status,
    work_row.status,
    work_row.attempt_count,
    work_row.processing_token,
    work_row.processing_expires_at,
    source_id,
    assessment_id;
end;
$$;

comment on function public.claim_total_loss_package_work_item(uuid, uuid) is
  'Atomically claims both work-item and package-job leases with one fencing token; terminal replay is read-only and stale workers cannot win after token rotation.';

create function public.resolve_total_loss_package_source_context(
  requested_work_item_id uuid,
  requested_processing_token uuid
)
returns table (
  case_id uuid,
  owner_user_id uuid,
  entitlement_id uuid,
  product_identifier text,
  product_version text,
  package_job_id uuid,
  work_item_id uuid,
  preliminary_snapshot_id uuid,
  analysis_job_id uuid,
  analysis_run_id uuid,
  source_intake_mode public.total_loss_intake_mode,
  source_report_upload_id uuid,
  source_analysis_input_revision bigint,
  source_analysis_input_id uuid,
  storage_owner_id uuid,
  storage_bucket_id text,
  storage_object_name text,
  storage_media_type text,
  storage_byte_size bigint,
  storage_object_exists boolean,
  source_report_original_filename text,
  source_report_uploaded_at timestamptz,
  lineage_current boolean,
  confirmed_facts jsonb,
  preliminary_snapshot jsonb,
  preliminary_source_references jsonb,
  preliminary_snapshot_digest text,
  preliminary_classification text,
  preliminary_currency text,
  preliminary_range_low_minor_units bigint,
  preliminary_range_median_minor_units bigint,
  preliminary_range_high_minor_units bigint,
  analysis_artifact jsonb,
  request_digest text,
  search_diagnostics_digest text,
  analysis_run_created_at timestamptz,
  analysis_run_schema_version text,
  analysis_version text,
  discrepancy_analysis_version text,
  comparable_scoring_version text,
  presentation_schema_version text,
  preliminary_snapshot_schema_version text,
  normalized_extraction jsonb,
  extraction_provider_name text,
  extraction_schema_version text,
  extraction_extracted_at timestamptz,
  existing_source_snapshot_id uuid,
  existing_source_snapshot jsonb,
  existing_source_snapshot_digest text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    package_job.case_id,
    appraisal_case.user_id,
    package_job.entitlement_id,
    entitlement.product_identifier,
    entitlement.product_version,
    package_job.id,
    work_item.id,
    preliminary.id,
    preliminary.analysis_job_id,
    preliminary.analysis_run_id,
    preliminary.source_intake_mode,
    preliminary.source_report_upload_id,
    preliminary.source_analysis_input_revision,
    preliminary.source_analysis_input_id,
    details.report_storage_owner_id,
    case when preliminary.source_intake_mode = 'report' then 'case-files' else null end,
    case
      when preliminary.source_intake_mode = 'report' then
        details.report_storage_owner_id::text || '/' || package_job.case_id::text
          || '/valuation-report.pdf'
      else null
    end,
    case
      when stored_object.metadata ->> 'mimetype' is not null
        then stored_object.metadata ->> 'mimetype'
      else null
    end,
    case
      when coalesce(stored_object.metadata ->> 'size', '') ~ '^[0-9]+$'
        then (stored_object.metadata ->> 'size')::bigint
      else null
    end,
    stored_object.id is not null,
    details.report_original_filename,
    details.report_uploaded_at,
    (
      details.analysis_input_revision = preliminary.source_analysis_input_revision
      and details.analysis_input_id is not distinct from preliminary.source_analysis_input_id
      and details.intake_mode = preliminary.source_intake_mode
      and (
        (
          details.intake_mode = 'report'
          and details.report_last_upload_id = preliminary.source_report_upload_id
        )
        or (
          details.intake_mode = 'manual'
          and preliminary.source_report_upload_id is null
        )
      )
    ),
    public.build_total_loss_analysis_input_snapshot(details),
    preliminary.snapshot,
    preliminary.source_references,
    preliminary.snapshot_digest,
    preliminary.preliminary_classification,
    preliminary.currency,
    preliminary.supported_range_low_minor_units,
    preliminary.supported_range_median_minor_units,
    preliminary.supported_range_high_minor_units,
    analysis_run.artifact,
    analysis_run.request_digest,
    analysis_run.search_diagnostics_digest,
    analysis_run.created_at,
    analysis_run.analysis_run_schema_version,
    analysis_run.analysis_version,
    analysis_run.discrepancy_analysis_version,
    analysis_run.comparable_scoring_version,
    preliminary.presentation_schema_version,
    preliminary.snapshot_schema_version,
    extraction.normalized_report,
    extraction.provider_name,
    extraction.extraction_schema_version,
    extraction.extracted_at,
    existing_source.id,
    existing_source.source_snapshot,
    existing_source.snapshot_digest
  from public.workflow_work_items as work_item
  join public.total_loss_package_jobs as package_job
    on package_job.id = work_item.package_job_id
    and package_job.case_id = work_item.case_id
  join public.case_entitlements as entitlement
    on entitlement.id = package_job.entitlement_id
    and entitlement.case_id = package_job.case_id
    and entitlement.preliminary_snapshot_id = package_job.preliminary_snapshot_id
  join public.appraisal_cases as appraisal_case
    on appraisal_case.id = package_job.case_id
    and appraisal_case.service_type = 'total_loss'
  join public.total_loss_claim_workflows as workflow
    on workflow.case_id = package_job.case_id
    and workflow.current_package_job_id = package_job.id
  join public.total_loss_preliminary_snapshots as preliminary
    on preliminary.id = package_job.preliminary_snapshot_id
    and preliminary.case_id = package_job.case_id
  join public.total_loss_analysis_jobs as analysis_job
    on analysis_job.id = preliminary.analysis_job_id
    and analysis_job.run_id = preliminary.analysis_run_id
    and analysis_job.case_id = preliminary.case_id
    and analysis_job.status = 'completed'
  join public.analysis_runs as analysis_run
    on analysis_run.id = preliminary.analysis_run_id
    and analysis_run.job_id = preliminary.analysis_job_id
    and analysis_run.case_id = preliminary.case_id
  join public.total_loss_case_details as details
    on details.case_id = package_job.case_id
  left join public.total_loss_report_extractions as extraction
    on extraction.case_id = package_job.case_id
    and extraction.report_upload_id = preliminary.source_report_upload_id
    and extraction.analysis_input_revision = preliminary.source_analysis_input_revision
    and extraction.analysis_input_id = preliminary.source_analysis_input_id
    and extraction.extraction_status = 'confirmed'
  left join storage.objects as stored_object
    on stored_object.bucket_id = 'case-files'
    and stored_object.name = details.report_storage_owner_id::text || '/'
      || package_job.case_id::text || '/valuation-report.pdf'
    and stored_object.user_metadata ->> 'uploadId' =
      preliminary.source_report_upload_id::text
  left join public.total_loss_source_snapshots as existing_source
    on existing_source.package_job_id = package_job.id
  where work_item.id = requested_work_item_id
    and work_item.status = 'processing'
    and work_item.processing_token = requested_processing_token
    and work_item.processing_expires_at > statement_timestamp()
    and package_job.processing_token = requested_processing_token
    and package_job.processing_expires_at > statement_timestamp()
    and package_job.status in ('processing', 'source_frozen')
    and (
      (
        entitlement.status = 'active'
        and exists (
          select 1
          from public.commerce_orders as commerce_order
          where commerce_order.id = entitlement.order_id
            and commerce_order.status in ('paid', 'partially_refunded')
        )
      )
      or (
        entitlement.status = 'refunded_access_retained'
        and exists (
          select 1
          from public.commerce_orders as commerce_order
          where commerce_order.id = entitlement.order_id
            and commerce_order.status = 'refunded'
        )
      )
    );
$$;

comment on function public.resolve_total_loss_package_source_context(uuid, uuid) is
  'Returns the active worker only the authoritative frozen-input candidates, full confirmed extraction wrapper, immutable run, and private source locator needed to build a commercial source snapshot.';

create function public.seal_total_loss_source_snapshot(
  requested_work_item_id uuid,
  requested_processing_token uuid,
  requested_source_snapshot_id uuid,
  requested_source_document_media_type text,
  requested_source_document_byte_size bigint,
  requested_source_document_sha256 text,
  requested_analysis_artifact_digest text,
  requested_normalized_extraction_digest text,
  requested_evidence_cutoff date,
  requested_snapshot_created_at timestamptz,
  requested_snapshot_schema_version text,
  requested_source_snapshot jsonb,
  requested_snapshot_digest text
)
returns table (
  outcome text,
  source_snapshot_id uuid,
  source_snapshot_digest text,
  package_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  work_row public.workflow_work_items%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  preliminary_row public.total_loss_preliminary_snapshots%rowtype;
  analysis_job_row public.total_loss_analysis_jobs%rowtype;
  analysis_run_row public.analysis_runs%rowtype;
  details_row public.total_loss_case_details%rowtype;
  extraction_row public.total_loss_report_extractions%rowtype;
  source_row public.total_loss_source_snapshots%rowtype;
  owner_user_id uuid;
  document_bucket text;
  document_name text;
  extraction_wrapper jsonb;
  extraction_model text;
  embedded_snapshot_created_at timestamptz;
begin
  if requested_work_item_id is null
    or requested_processing_token is null
    or requested_source_snapshot_id is null
    or requested_analysis_artifact_digest is null
    or requested_analysis_artifact_digest !~ '^[0-9a-f]{64}$'
    or requested_evidence_cutoff is null
    or requested_snapshot_created_at is null
    or requested_snapshot_schema_version is null
    or requested_snapshot_schema_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or requested_source_snapshot is null
    or jsonb_typeof(requested_source_snapshot) <> 'object'
    or requested_snapshot_digest is null
    or requested_snapshot_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Source snapshot payload is invalid.';
  end if;

  begin
    embedded_snapshot_created_at :=
      (requested_source_snapshot ->> 'createdAt')::timestamptz;
  exception
    when others then
      raise exception using
        errcode = '22023',
        message = 'Source snapshot createdAt is invalid.';
  end;

  if embedded_snapshot_created_at is distinct from requested_snapshot_created_at then
    raise exception using
      errcode = '55000',
      message = 'Source snapshot creation time does not match its canonical JSON.';
  end if;

  select work_item.*
  into work_row
  from public.workflow_work_items as work_item
  where work_item.id = requested_work_item_id
  for update;

  if not found then
    return;
  end if;

  select package_job.*
  into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = work_row.package_job_id
    and package_job.case_id = work_row.case_id
  for update;

  if work_row.status <> 'processing'
    or work_row.processing_token is distinct from requested_processing_token
    or work_row.processing_expires_at <= statement_timestamp()
    or package_row.status not in ('processing', 'source_frozen')
    or package_row.processing_token is distinct from requested_processing_token
    or package_row.processing_expires_at <= statement_timestamp() then
    return;
  end if;

  select source_snapshot.*
  into source_row
  from public.total_loss_source_snapshots as source_snapshot
  where source_snapshot.package_job_id = package_row.id;

  if found then
    if source_row.id is distinct from requested_source_snapshot_id
      or source_row.snapshot_digest is distinct from requested_snapshot_digest
      or source_row.source_snapshot is distinct from requested_source_snapshot
      or source_row.analysis_artifact_digest is distinct from requested_analysis_artifact_digest
      or source_row.normalized_extraction_digest is distinct from requested_normalized_extraction_digest
      or source_row.source_document_sha256 is distinct from requested_source_document_sha256
      or source_row.evidence_cutoff is distinct from requested_evidence_cutoff
      or source_row.snapshot_created_at is distinct from requested_snapshot_created_at
      or source_row.snapshot_schema_version is distinct from requested_snapshot_schema_version then
      raise exception using errcode = '55000', message = 'Source snapshot replay conflicts with the immutable package source.';
    end if;

    return query select
      'existing'::text,
      source_row.id,
      source_row.snapshot_digest,
      package_row.status;
    return;
  end if;

  select entitlement.*
  into entitlement_row
  from public.case_entitlements as entitlement
  where entitlement.id = package_row.entitlement_id
    and entitlement.case_id = package_row.case_id
    and entitlement.preliminary_snapshot_id = package_row.preliminary_snapshot_id
  for update;

  if entitlement_row.id is null
    or entitlement_row.status not in ('active', 'refunded_access_retained') then
    raise exception using errcode = '55000', message = 'Package entitlement is unavailable.';
  end if;

  select preliminary.*
  into preliminary_row
  from public.total_loss_preliminary_snapshots as preliminary
  where preliminary.id = package_row.preliminary_snapshot_id
    and preliminary.case_id = package_row.case_id;

  select analysis_job.*
  into analysis_job_row
  from public.total_loss_analysis_jobs as analysis_job
  where analysis_job.id = preliminary_row.analysis_job_id
    and analysis_job.run_id = preliminary_row.analysis_run_id
    and analysis_job.case_id = preliminary_row.case_id
    and analysis_job.status = 'completed';

  select analysis_run.*
  into analysis_run_row
  from public.analysis_runs as analysis_run
  where analysis_run.id = preliminary_row.analysis_run_id
    and analysis_run.job_id = preliminary_row.analysis_job_id
    and analysis_run.case_id = preliminary_row.case_id;

  select details.*
  into details_row
  from public.total_loss_case_details as details
  where details.case_id = package_row.case_id;

  select appraisal_case.user_id
  into owner_user_id
  from public.appraisal_cases as appraisal_case
  join auth.users as auth_user on auth_user.id = appraisal_case.user_id
  where appraisal_case.id = package_row.case_id
    and appraisal_case.service_type = 'total_loss'
    and not coalesce(auth_user.is_anonymous, false)
    and auth_user.email_confirmed_at is not null;

  if preliminary_row.id is null
    or analysis_job_row.id is null
    or analysis_run_row.id is null
    or details_row.case_id is null
    or owner_user_id is null
    or details_row.intake_mode is distinct from preliminary_row.source_intake_mode
    or details_row.analysis_input_revision is distinct from
      preliminary_row.source_analysis_input_revision
    or details_row.analysis_input_id is distinct from
      preliminary_row.source_analysis_input_id
    or (
      preliminary_row.source_intake_mode = 'report'
      and details_row.report_last_upload_id is distinct from
        preliminary_row.source_report_upload_id
    )
    or analysis_run_row.request_digest is distinct from
      (analysis_run_row.artifact ->> 'requestDigest')
    or preliminary_row.snapshot_digest is null then
    raise exception using errcode = '55000', message = 'Source lineage no longer matches the preliminary snapshot.';
  end if;

  if requested_source_snapshot ->> 'schemaVersion' is distinct from
      requested_snapshot_schema_version
    or requested_source_snapshot ->> 'snapshotDigest' is distinct from
      requested_snapshot_digest
    or requested_source_snapshot #>> '{lineage,caseId}' is distinct from
      package_row.case_id::text
    or requested_source_snapshot #>> '{lineage,packageJobId}' is distinct from
      package_row.id::text
    or requested_source_snapshot #>> '{lineage,entitlementId}' is distinct from
      package_row.entitlement_id::text
    or requested_source_snapshot #>> '{lineage,preliminarySnapshotId}' is distinct from
      package_row.preliminary_snapshot_id::text
    or requested_source_snapshot #>> '{lineage,sourceSnapshotId}' is distinct from
      requested_source_snapshot_id::text
    or requested_source_snapshot #>> '{lineage,analysisJobId}' is distinct from
      preliminary_row.analysis_job_id::text
    or requested_source_snapshot #>> '{lineage,analysisRunId}' is distinct from
      preliminary_row.analysis_run_id::text
    or requested_source_snapshot #>> '{lineage,ownerUserIdAtCreation}' is distinct from
      owner_user_id::text
    or requested_source_snapshot #>> '{lineage,productIdentifier}' is distinct from
      entitlement_row.product_identifier
    or requested_source_snapshot #>> '{lineage,productVersion}' is distinct from
      entitlement_row.product_version
    or requested_source_snapshot #>> '{input,intakeMode}' is distinct from
      upper(preliminary_row.source_intake_mode::text)
    or requested_source_snapshot #>> '{input,analysisInputRevision}' is distinct from
      preliminary_row.source_analysis_input_revision::text
    or requested_source_snapshot #>> '{input,analysisInputId}' is distinct from
      preliminary_row.source_analysis_input_id::text
    or requested_source_snapshot #>> '{analysis,artifactDigest}' is distinct from
      requested_analysis_artifact_digest
    or requested_source_snapshot #>> '{analysis,requestDigest}' is distinct from
      analysis_run_row.request_digest
    or requested_source_snapshot #>> '{preliminary,snapshotDigest}' is distinct from
      preliminary_row.snapshot_digest
    or requested_source_snapshot #>> '{preliminary,snapshotSchemaVersion}' is distinct from
      preliminary_row.snapshot_schema_version then
    raise exception using
      errcode = '55000',
      message = 'Source snapshot embedded lineage is invalid.';
  end if;

  if preliminary_row.source_intake_mode = 'report' then
    document_bucket := 'case-files';
    document_name := details_row.report_storage_owner_id::text || '/'
      || package_row.case_id::text || '/valuation-report.pdf';

    if requested_source_document_media_type is null
      or lower(split_part(requested_source_document_media_type, ';', 1)) <> 'application/pdf'
      or requested_source_document_byte_size is null
      or requested_source_document_byte_size <= 0
      or requested_source_document_sha256 is null
      or requested_source_document_sha256 !~ '^[0-9a-f]{64}$'
      or not exists (
        select 1
        from storage.objects as stored_object
        where stored_object.bucket_id = document_bucket
          and stored_object.name = document_name
          and stored_object.user_metadata ->> 'uploadId' =
            preliminary_row.source_report_upload_id::text
      ) then
      raise exception using errcode = '55000', message = 'Private source report integrity is unavailable.';
    end if;

    select extraction.*
    into extraction_row
    from public.total_loss_report_extractions as extraction
    where extraction.case_id = package_row.case_id
      and extraction.report_upload_id = preliminary_row.source_report_upload_id
      and extraction.analysis_input_revision =
        preliminary_row.source_analysis_input_revision
      and extraction.analysis_input_id = preliminary_row.source_analysis_input_id
      and extraction.extraction_status = 'confirmed';

    if found then
      extraction_wrapper := extraction_row.normalized_report;
      extraction_model := extraction_wrapper ->> 'model';

      if requested_normalized_extraction_digest is null
        or requested_normalized_extraction_digest !~ '^[0-9a-f]{64}$'
        or extraction_wrapper ->> 'documentSha256' is distinct from
          requested_source_document_sha256 then
        raise exception using errcode = '55000', message = 'Confirmed extraction integrity does not match the source report.';
      end if;
    elsif requested_normalized_extraction_digest is not null then
      raise exception using errcode = '55000', message = 'Unexpected extraction digest was supplied.';
    end if;
  else
    if requested_source_document_media_type is not null
      or requested_source_document_byte_size is not null
      or requested_source_document_sha256 is not null
      or requested_normalized_extraction_digest is not null then
      raise exception using errcode = '22023', message = 'Manual source snapshots cannot contain report-document metadata.';
    end if;
  end if;

  insert into public.total_loss_source_snapshots (
    id,
    case_id,
    package_job_id,
    entitlement_id,
    preliminary_snapshot_id,
    analysis_job_id,
    analysis_run_id,
    owner_user_id_at_creation,
    source_intake_mode,
    source_report_upload_id,
    source_analysis_input_revision,
    source_analysis_input_id,
    source_document_bucket_id,
    source_document_object_name,
    source_document_media_type,
    source_document_byte_size,
    source_document_sha256,
    extraction_available,
    extraction_provider_name,
    extraction_model_identifier,
    extraction_schema_version,
    normalized_extraction_digest,
    analysis_artifact_digest,
    preliminary_snapshot_digest,
    request_digest,
    search_diagnostics_digest,
    evidence_cutoff,
    snapshot_created_at,
    analysis_run_schema_version,
    analysis_version,
    discrepancy_analysis_version,
    comparable_scoring_version,
    presentation_schema_version,
    preliminary_snapshot_schema_version,
    snapshot_schema_version,
    source_snapshot,
    snapshot_digest
  ) values (
    requested_source_snapshot_id,
    package_row.case_id,
    package_row.id,
    package_row.entitlement_id,
    package_row.preliminary_snapshot_id,
    preliminary_row.analysis_job_id,
    preliminary_row.analysis_run_id,
    owner_user_id,
    preliminary_row.source_intake_mode,
    preliminary_row.source_report_upload_id,
    preliminary_row.source_analysis_input_revision,
    preliminary_row.source_analysis_input_id,
    document_bucket,
    document_name,
    requested_source_document_media_type,
    requested_source_document_byte_size,
    requested_source_document_sha256,
    extraction_wrapper is not null,
    extraction_row.provider_name,
    extraction_model,
    extraction_row.extraction_schema_version,
    requested_normalized_extraction_digest,
    requested_analysis_artifact_digest,
    preliminary_row.snapshot_digest,
    analysis_run_row.request_digest,
    analysis_run_row.search_diagnostics_digest,
    requested_evidence_cutoff,
    requested_snapshot_created_at,
    analysis_run_row.analysis_run_schema_version,
    analysis_run_row.analysis_version,
    analysis_run_row.discrepancy_analysis_version,
    analysis_run_row.comparable_scoring_version,
    preliminary_row.presentation_schema_version,
    preliminary_row.snapshot_schema_version,
    requested_snapshot_schema_version,
    requested_source_snapshot,
    requested_snapshot_digest
  )
  returning * into source_row;

  update public.total_loss_package_jobs as package_job
  set status = 'source_frozen'
  where package_job.id = package_row.id
    and package_job.status = 'processing'
    and package_job.processing_token = requested_processing_token
  returning * into package_row;

  if not found then
    raise exception using errcode = '55000', message = 'Package source fence changed during sealing.';
  end if;

  return query select
    'created'::text,
    source_row.id,
    source_row.snapshot_digest,
    package_row.status;
end;
$$;

comment on function public.seal_total_loss_source_snapshot(uuid, uuid, uuid, text, bigint, text, text, text, date, timestamptz, text, jsonb, text) is
  'Fenced, replay-safe commercial source freeze; report sources require the exact private object and confirmed extraction digest while manual sources prohibit document metadata.';

create function public.persist_total_loss_final_assessment(
  requested_work_item_id uuid,
  requested_processing_token uuid,
  requested_source_snapshot_id uuid,
  requested_conclusion_code text,
  requested_currency text,
  requested_range_low_minor_units bigint,
  requested_range_median_minor_units bigint,
  requested_range_high_minor_units bigint,
  requested_findings jsonb,
  requested_limitations jsonb,
  requested_reason_codes jsonb,
  requested_preliminary_to_final_comparison jsonb,
  requested_assessment jsonb,
  requested_methodology_version text,
  requested_schema_version text,
  requested_assessment_digest text
)
returns table (
  outcome text,
  final_assessment_id uuid,
  assessment_digest text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  work_row public.workflow_work_items%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  source_row public.total_loss_source_snapshots%rowtype;
  assessment_row public.total_loss_final_assessments%rowtype;
begin
  if requested_work_item_id is null
    or requested_processing_token is null
    or requested_source_snapshot_id is null
    or requested_conclusion_code is null
    or requested_conclusion_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    or requested_currency is null
    or requested_currency !~ '^[A-Z]{3}$'
    or requested_findings is null
    or jsonb_typeof(requested_findings) <> 'array'
    or requested_limitations is null
    or jsonb_typeof(requested_limitations) <> 'array'
    or requested_reason_codes is null
    or jsonb_typeof(requested_reason_codes) <> 'array'
    or requested_preliminary_to_final_comparison is null
    or jsonb_typeof(requested_preliminary_to_final_comparison) <> 'object'
    or requested_assessment is null
    or jsonb_typeof(requested_assessment) <> 'object'
    or requested_methodology_version is null
    or requested_methodology_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or requested_schema_version is null
    or requested_schema_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or requested_assessment_digest is null
    or requested_assessment_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Final assessment payload is invalid.';
  end if;

  select work_item.*
  into work_row
  from public.workflow_work_items as work_item
  where work_item.id = requested_work_item_id
  for update;

  select package_job.*
  into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = work_row.package_job_id
    and package_job.case_id = work_row.case_id
  for update;

  if work_row.id is null
    or work_row.status <> 'processing'
    or work_row.processing_token is distinct from requested_processing_token
    or work_row.processing_expires_at <= statement_timestamp()
    or package_row.status <> 'source_frozen'
    or package_row.processing_token is distinct from requested_processing_token
    or package_row.processing_expires_at <= statement_timestamp() then
    return;
  end if;

  select source_snapshot.*
  into source_row
  from public.total_loss_source_snapshots as source_snapshot
  where source_snapshot.id = requested_source_snapshot_id
    and source_snapshot.package_job_id = package_row.id
    and source_snapshot.case_id = package_row.case_id
    and source_snapshot.preliminary_snapshot_id = package_row.preliminary_snapshot_id;

  if not found then
    raise exception using errcode = '55000', message = 'Final assessment source lineage is invalid.';
  end if;

  if requested_assessment ->> 'schemaVersion' is distinct from
      requested_schema_version
    or requested_assessment ->> 'methodologyVersion' is distinct from
      requested_methodology_version
    or requested_assessment ->> 'assessmentDigest' is distinct from
      requested_assessment_digest
    or requested_assessment #>> '{lineage,caseId}' is distinct from
      package_row.case_id::text
    or requested_assessment #>> '{lineage,packageJobId}' is distinct from
      package_row.id::text
    or requested_assessment #>> '{lineage,entitlementId}' is distinct from
      package_row.entitlement_id::text
    or requested_assessment #>> '{lineage,preliminarySnapshotId}' is distinct from
      package_row.preliminary_snapshot_id::text
    or requested_assessment #>> '{lineage,sourceSnapshotId}' is distinct from
      source_row.id::text
    or requested_assessment #>> '{lineage,analysisRunId}' is distinct from
      source_row.analysis_run_id::text
    or requested_assessment ->> 'sourceSnapshotDigest' is distinct from
      source_row.snapshot_digest
    or requested_assessment ->> 'analysisArtifactDigest' is distinct from
      source_row.analysis_artifact_digest
    or requested_assessment ->> 'finalClassification' is distinct from
      requested_conclusion_code
    or requested_assessment -> 'findings' is distinct from requested_findings
    or requested_assessment -> 'limitations' is distinct from requested_limitations
    or requested_assessment -> 'preliminaryToFinalComparison' is distinct from
      requested_preliminary_to_final_comparison then
    raise exception using
      errcode = '55000',
      message = 'Final assessment embedded lineage is invalid.';
  end if;

  select final_assessment.*
  into assessment_row
  from public.total_loss_final_assessments as final_assessment
  where final_assessment.package_job_id = package_row.id;

  if found then
    if assessment_row.source_snapshot_id is distinct from source_row.id
      or assessment_row.conclusion_code is distinct from requested_conclusion_code
      or assessment_row.currency is distinct from requested_currency
      or assessment_row.supported_range_low_minor_units is distinct from requested_range_low_minor_units
      or assessment_row.supported_range_median_minor_units is distinct from requested_range_median_minor_units
      or assessment_row.supported_range_high_minor_units is distinct from requested_range_high_minor_units
      or assessment_row.findings is distinct from requested_findings
      or assessment_row.limitations is distinct from requested_limitations
      or assessment_row.reason_codes is distinct from requested_reason_codes
      or assessment_row.preliminary_to_final_comparison is distinct from requested_preliminary_to_final_comparison
      or assessment_row.assessment is distinct from requested_assessment
      or assessment_row.methodology_version is distinct from requested_methodology_version
      or assessment_row.schema_version is distinct from requested_schema_version
      or assessment_row.assessment_digest is distinct from requested_assessment_digest then
      raise exception using errcode = '55000', message = 'Final assessment replay conflicts with the immutable package assessment.';
    end if;

    return query select 'existing'::text, assessment_row.id, assessment_row.assessment_digest;
    return;
  end if;

  insert into public.total_loss_final_assessments (
    case_id,
    package_job_id,
    preliminary_snapshot_id,
    source_snapshot_id,
    version_number,
    supersedes_assessment_id,
    conclusion_code,
    currency,
    supported_range_low_minor_units,
    supported_range_median_minor_units,
    supported_range_high_minor_units,
    findings,
    limitations,
    reason_codes,
    preliminary_to_final_comparison,
    assessment,
    methodology_version,
    schema_version,
    assessment_digest
  ) values (
    package_row.case_id,
    package_row.id,
    package_row.preliminary_snapshot_id,
    source_row.id,
    1,
    null,
    requested_conclusion_code,
    requested_currency,
    requested_range_low_minor_units,
    requested_range_median_minor_units,
    requested_range_high_minor_units,
    requested_findings,
    requested_limitations,
    requested_reason_codes,
    requested_preliminary_to_final_comparison,
    requested_assessment,
    requested_methodology_version,
    requested_schema_version,
    requested_assessment_digest
  )
  returning * into assessment_row;

  return query select 'created'::text, assessment_row.id, assessment_row.assessment_digest;
end;
$$;

comment on function public.persist_total_loss_final_assessment(uuid, uuid, uuid, text, text, bigint, bigint, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text) is
  'Persists one immutable assessment per package under the current dual fence; exact replay returns the existing row and conflicting replay fails closed.';

create function public.complete_total_loss_package_work_item(
  requested_work_item_id uuid,
  requested_processing_token uuid,
  requested_final_assessment_id uuid,
  requested_package_status text,
  requested_reason_code text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  work_row public.workflow_work_items%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  assessment_row public.total_loss_final_assessments%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  next_task text;
begin
  if requested_work_item_id is null
    or requested_processing_token is null
    or requested_final_assessment_id is null
    or requested_package_status not in (
      'assessment_ready',
      'review_required',
      'new_evidence_required'
    )
    or (
      requested_package_status = 'assessment_ready'
      and requested_reason_code is not null
    )
    or (
      requested_package_status in ('review_required', 'new_evidence_required')
      and (
        requested_reason_code is null
        or requested_reason_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
      )
    ) then
    raise exception using errcode = '22023', message = 'Package completion is invalid.';
  end if;

  select work_item.*
  into work_row
  from public.workflow_work_items as work_item
  where work_item.id = requested_work_item_id
  for update;

  if not found then
    return false;
  end if;

  select package_job.*
  into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = work_row.package_job_id
    and package_job.case_id = work_row.case_id
  for update;

  select final_assessment.*
  into assessment_row
  from public.total_loss_final_assessments as final_assessment
  where final_assessment.id = requested_final_assessment_id
    and final_assessment.package_job_id = package_row.id
    and final_assessment.case_id = package_row.case_id
    and final_assessment.preliminary_snapshot_id = package_row.preliminary_snapshot_id;

  if work_row.status = 'completed' then
    return work_row.processing_token = requested_processing_token
      and package_row.processing_token = requested_processing_token
      and package_row.status = requested_package_status
      and assessment_row.id = requested_final_assessment_id
      and package_row.failure_code is not distinct from requested_reason_code;
  end if;

  if assessment_row.id is null
    or assessment_row.source_snapshot_id is null
    or work_row.status <> 'processing'
    or work_row.processing_token is distinct from requested_processing_token
    or work_row.processing_expires_at <= statement_timestamp()
    or package_row.status <> 'source_frozen'
    or package_row.processing_token is distinct from requested_processing_token
    or package_row.processing_expires_at <= statement_timestamp()
    or not exists (
      select 1
      from public.total_loss_source_snapshots as source_snapshot
      where source_snapshot.id = assessment_row.source_snapshot_id
        and source_snapshot.package_job_id = package_row.id
    )
    or not exists (
      select 1
      from public.case_entitlements as entitlement
      join public.commerce_orders as commerce_order
        on commerce_order.id = entitlement.order_id
        and commerce_order.case_id = entitlement.case_id
      where entitlement.id = package_row.entitlement_id
        and entitlement.case_id = package_row.case_id
        and (
          (
            entitlement.status = 'active'
            and commerce_order.status in ('paid', 'partially_refunded')
          )
          or (
            entitlement.status = 'refunded_access_retained'
            and commerce_order.status = 'refunded'
          )
        )
    ) then
    return false;
  end if;

  next_task := case requested_package_status
    when 'assessment_ready' then 'awaiting_report_generation'
    when 'review_required' then 'assessment_review_required'
    else 'new_evidence_required'
  end;

  select workflow.*
  into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = package_row.case_id
    and workflow.current_package_job_id = package_row.id
    and workflow.phase = 'review'
  for update;

  if not found then
    return false;
  end if;

  update public.total_loss_package_jobs as package_job
  set
    status = requested_package_status,
    processing_expires_at = null,
    failure_code = requested_reason_code,
    retryable = case
      when requested_package_status = 'assessment_ready' then null
      else false
    end,
    finished_at = statement_timestamp()
  where package_job.id = package_row.id
    and package_job.processing_token = requested_processing_token;

  if not found then
    return false;
  end if;

  update public.workflow_work_items as work_item
  set
    status = 'completed',
    processing_expires_at = null,
    last_error_code = null,
    retryable = null,
    completed_at = statement_timestamp(),
    failed_at = null
  where work_item.id = work_row.id
    and work_item.processing_token = requested_processing_token;

  if not found then
    raise exception using errcode = '55000', message = 'Work-item completion fence changed.';
  end if;

  update public.total_loss_claim_workflows as workflow
  set
    current_task = next_task,
    revision = workflow.revision + 1
  where workflow.case_id = workflow_row.case_id
    and workflow.revision = workflow_row.revision;

  if not found then
    raise exception using errcode = '40001', message = 'Claim workflow revision changed during package completion.';
  end if;

  insert into public.total_loss_workflow_events (
    case_id,
    event_type,
    actor_type,
    associated_entity_type,
    associated_entity_id,
    client_request_id,
    details
  ) values (
    package_row.case_id,
    'package.assessment_completed',
    'system',
    'total_loss_package_job',
    package_row.id,
    work_row.id,
    jsonb_build_object('packageStatus', requested_package_status)
  );

  return true;
end;
$$;

comment on function public.complete_total_loss_package_work_item(uuid, uuid, uuid, text, text) is
  'Atomically terminalizes one assessed package, its work item, and the dedicated workflow under the winning worker fence.';

create function public.fail_total_loss_package_work_item(
  requested_work_item_id uuid,
  requested_processing_token uuid,
  requested_failure_code text,
  requested_failure_kind text,
  requested_retry_delay_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  work_row public.workflow_work_items%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  target_package_status text;
  target_work_status text;
  target_retryable boolean;
  next_task text;
begin
  if requested_work_item_id is null
    or requested_processing_token is null
    or requested_failure_code is null
    or requested_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    or requested_failure_kind not in ('retryable', 'review_required', 'terminal')
    or (
      requested_failure_kind = 'retryable'
      and (
        requested_retry_delay_seconds is null
        or requested_retry_delay_seconds < 1
        or requested_retry_delay_seconds > 86400
      )
    )
    or (
      requested_failure_kind <> 'retryable'
      and requested_retry_delay_seconds is not null
    ) then
    raise exception using errcode = '22023', message = 'Package failure is invalid.';
  end if;

  target_package_status := case requested_failure_kind
    when 'retryable' then 'retryable_failed'
    when 'review_required' then 'review_required'
    else 'failed'
  end;
  target_work_status := case
    when requested_failure_kind = 'retryable' then 'retryable_failed'
    else 'terminal_failed'
  end;
  target_retryable := requested_failure_kind = 'retryable';
  next_task := case requested_failure_kind
    when 'review_required' then 'assessment_review_required'
    when 'terminal' then 'package_failed'
    else null
  end;

  select work_item.*
  into work_row
  from public.workflow_work_items as work_item
  where work_item.id = requested_work_item_id
  for update;

  if not found then
    return false;
  end if;

  select package_job.*
  into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = work_row.package_job_id
    and package_job.case_id = work_row.case_id
  for update;

  if work_row.status in ('retryable_failed', 'terminal_failed') then
    return work_row.processing_token = requested_processing_token
      and package_row.processing_token = requested_processing_token
      and work_row.status = target_work_status
      and package_row.status = target_package_status
      and work_row.last_error_code = requested_failure_code
      and package_row.failure_code = requested_failure_code;
  end if;

  if work_row.status <> 'processing'
    or work_row.processing_token is distinct from requested_processing_token
    or work_row.processing_expires_at <= statement_timestamp()
    or package_row.status not in ('processing', 'source_frozen')
    or package_row.processing_token is distinct from requested_processing_token
    or package_row.processing_expires_at <= statement_timestamp() then
    return false;
  end if;

  if next_task is not null then
    select workflow.*
    into workflow_row
    from public.total_loss_claim_workflows as workflow
    where workflow.case_id = package_row.case_id
      and workflow.current_package_job_id = package_row.id
      and workflow.phase = 'review'
    for update;

    if not found then
      return false;
    end if;
  end if;

  update public.total_loss_package_jobs as package_job
  set
    status = target_package_status,
    processing_expires_at = null,
    failure_code = requested_failure_code,
    retryable = target_retryable,
    finished_at = statement_timestamp()
  where package_job.id = package_row.id
    and package_job.processing_token = requested_processing_token;

  update public.workflow_work_items as work_item
  set
    status = target_work_status,
    next_attempt_at = case
      when requested_failure_kind = 'retryable' then
        statement_timestamp()
          + pg_catalog.make_interval(secs => requested_retry_delay_seconds)
      else work_item.next_attempt_at
    end,
    processing_expires_at = null,
    last_error_code = requested_failure_code,
    retryable = target_retryable,
    completed_at = null,
    failed_at = statement_timestamp()
  where work_item.id = work_row.id
    and work_item.processing_token = requested_processing_token;

  if not found then
    raise exception using errcode = '55000', message = 'Work-item failure fence changed.';
  end if;

  if next_task is not null then
    update public.total_loss_claim_workflows as workflow
    set
      current_task = next_task,
      revision = workflow.revision + 1
    where workflow.case_id = workflow_row.case_id
      and workflow.revision = workflow_row.revision;

    if not found then
      raise exception using errcode = '40001', message = 'Claim workflow revision changed during package failure.';
    end if;

    insert into public.total_loss_workflow_events (
      case_id,
      event_type,
      actor_type,
      associated_entity_type,
      associated_entity_id,
      client_request_id,
      details
    ) values (
      package_row.case_id,
      'package.processing_failed',
      'system',
      'total_loss_package_job',
      package_row.id,
      work_row.id,
      jsonb_build_object(
        'failureCode', requested_failure_code,
        'failureKind', requested_failure_kind
      )
    );
  end if;

  return true;
end;
$$;

comment on function public.fail_total_loss_package_work_item(uuid, uuid, text, text, integer) is
  'Records only bounded retryable, review-required, or terminal package failures under the current dual worker fence.';

create or replace function public.resolve_total_loss_case_claim(requested_case_id uuid)
returns setof public.total_loss_case_claim_resume_result
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  authenticated_user auth.users%rowtype;
  contact_row public.total_loss_case_contacts%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  order_row public.commerce_orders%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  result_row public.total_loss_case_claim_resume_result;
begin
  if authenticated_user_id is null or requested_case_id is null then
    return;
  end if;

  select auth_user.*
  into authenticated_user
  from auth.users as auth_user
  where auth_user.id = authenticated_user_id;

  if not found then
    return;
  end if;

  select contact.*
  into contact_row
  from public.appraisal_cases as appraisal_case
  join public.total_loss_case_contacts as contact
    on contact.case_id = appraisal_case.id
  where appraisal_case.id = requested_case_id
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss';

  if not found
    or not public.total_loss_post_continue_case_is_eligible_internal(requested_case_id)
  then
    return;
  end if;

  select workflow.*
  into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = requested_case_id;

  select commerce_order.*
  into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.case_id = requested_case_id
  order by commerce_order.created_at desc, commerce_order.id desc
  limit 1;

  if order_row.id is not null then
    select entitlement.*
    into entitlement_row
    from public.case_entitlements as entitlement
    where entitlement.order_id = order_row.id;
  end if;

  if coalesce(authenticated_user.is_anonymous, false) then
    if not public.total_loss_case_identity_transfer_allowed_internal(requested_case_id) then
      return;
    end if;
    result_row.state := 'secure_required';
  elsif authenticated_user.email_confirmed_at is not null
    and nullif(btrim(authenticated_user.email), '') is not null
    and lower(btrim(authenticated_user.email)) = contact_row.email
  then
    result_row.state := 'secured';
  else
    result_row.state := 'account_mismatch';
  end if;

  result_row.case_id := requested_case_id;
  result_row.contact_email := contact_row.email;
  result_row.workflow_phase := workflow_row.phase::text;
  result_row.workflow_current_task := workflow_row.current_task;
  result_row.workflow_revision := workflow_row.revision;
  result_row.checkout_available := (
    result_row.state = 'secured'
    and workflow_row.phase = 'review'
    and workflow_row.current_task = 'secure_claim'
    and entitlement_row.id is null
    and (
      order_row.id is null
      or (
        order_row.status = 'pending'
        and order_row.purchaser_email is not null
      )
    )
    and not exists (
      select 1
      from public.checkout_attempts as completed_attempt
      where completed_attempt.order_id = order_row.id
        and completed_attempt.status = 'complete'
    )
  );
  if result_row.state = 'secured' then
    result_row.commerce_order_status := order_row.status::text;
    result_row.payment_status := case
      when order_row.id is null then null
      when order_row.status = 'pending' then 'pending'
      when order_row.status = 'paid' then 'succeeded'
      when order_row.status in ('partially_refunded', 'refunded') then 'refunded'
      when order_row.status = 'disputed' then 'disputed'
      else null
    end;
    result_row.entitlement_status := entitlement_row.status::text;
    result_row.next_task := case
      when entitlement_row.status = 'suspended' then 'payment_review'
      when entitlement_row.status = 'revoked' then 'purchase_unavailable'
      when entitlement_row.id is not null
        and workflow_row.current_package_job_id is not null
        then workflow_row.current_task
      when entitlement_row.id is not null then 'purchase_complete'
      when result_row.checkout_available then 'checkout'
      when order_row.status = 'void' then 'purchase_unavailable'
      else workflow_row.current_task
    end;
  else
    result_row.commerce_order_status := null;
    result_row.payment_status := null;
    result_row.entitlement_status := null;
    result_row.next_task := null;
  end if;
  return next result_row;
end;
$$;

comment on function public.resolve_total_loss_case_claim(uuid) is
  'Owner-safe secure/resume projection whose next task follows the dedicated package workflow after an entitled case has entered M4 processing.';

create trigger total_loss_package_jobs_protect_m4_terminal
before update or delete on public.total_loss_package_jobs
for each row execute function public.protect_total_loss_terminal_record(
  'assessment_ready',
  'review_required',
  'new_evidence_required',
  'failed',
  'ready',
  'not_supportable'
);

revoke execute on function public.enqueue_total_loss_package_job(uuid)
  from public, anon, authenticated;
grant execute on function public.enqueue_total_loss_package_job(uuid)
  to service_role;

revoke execute on function public.reserve_due_workflow_work_items(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_due_workflow_work_items(uuid, integer)
  to service_role;

revoke execute on function public.reconcile_total_loss_package_work_items(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.reconcile_total_loss_package_work_items(uuid, integer)
  to service_role;

revoke execute on function public.mark_workflow_work_item_dispatched(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.mark_workflow_work_item_dispatched(uuid, uuid)
  to service_role;

revoke execute on function public.release_workflow_work_item_dispatch(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.release_workflow_work_item_dispatch(uuid, uuid, text, integer)
  to service_role;

revoke execute on function public.claim_total_loss_package_work_item(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_total_loss_package_work_item(uuid, uuid)
  to service_role;

revoke execute on function public.resolve_total_loss_package_source_context(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_total_loss_package_source_context(uuid, uuid)
  to service_role;

revoke execute on function public.seal_total_loss_source_snapshot(
  uuid, uuid, uuid, text, bigint, text, text, text, date, timestamptz, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.seal_total_loss_source_snapshot(
  uuid, uuid, uuid, text, bigint, text, text, text, date, timestamptz, text, jsonb, text
) to service_role;

revoke execute on function public.persist_total_loss_final_assessment(
  uuid, uuid, uuid, text, text, bigint, bigint, bigint,
  jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text
) from public, anon, authenticated;
grant execute on function public.persist_total_loss_final_assessment(
  uuid, uuid, uuid, text, text, bigint, bigint, bigint,
  jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text
) to service_role;

revoke execute on function public.complete_total_loss_package_work_item(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_total_loss_package_work_item(uuid, uuid, uuid, text, text)
  to service_role;

revoke execute on function public.fail_total_loss_package_work_item(uuid, uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.fail_total_loss_package_work_item(uuid, uuid, text, text, integer)
  to service_role;
