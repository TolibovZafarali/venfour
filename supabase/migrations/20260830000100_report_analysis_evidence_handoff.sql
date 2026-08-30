-- Preserve the exact document interpretation used by deferred report analysis.
-- This is separate from customer-confirmed intake and remains private/immutable.
create table public.total_loss_analysis_report_evidence (
  analysis_run_id uuid primary key references public.analysis_runs(id) on delete restrict,
  analysis_job_id uuid not null,
  case_id uuid not null,
  report_upload_id uuid not null,
  analysis_input_revision bigint not null check (analysis_input_revision > 0),
  analysis_input_id uuid not null,
  ingestion jsonb not null check (coalesce((
    jsonb_typeof(ingestion) = 'object'
    and ingestion->>'schemaVersion' = '1'
    and jsonb_typeof(ingestion->'normalizedReport') = 'object'
    and ingestion->>'documentSha256' ~ '^[0-9a-f]{64}$'
    and octet_length(ingestion::text) <= 2097152
  ),false)),
  evidence_origin text not null check (evidence_origin in ('analysis', 'verified_recovery')),
  recorded_at timestamptz not null default statement_timestamp(),
  foreign key (analysis_run_id, analysis_job_id, case_id)
    references public.total_loss_analysis_jobs(run_id, id, case_id) on delete restrict
);
alter table public.total_loss_analysis_report_evidence enable row level security;
revoke all on public.total_loss_analysis_report_evidence from public, anon, authenticated, service_role;
create trigger total_loss_analysis_report_evidence_immutable
before update or delete on public.total_loss_analysis_report_evidence
for each row execute function public.reject_total_loss_immutable_record();

create function public.complete_total_loss_report_analysis(
  job_id uuid, processing_token uuid, run_id uuid, artifact jsonb, ingestion jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  job public.total_loss_analysis_jobs%rowtype;
  details public.total_loss_case_details%rowtype;
  stored public.total_loss_analysis_report_evidence%rowtype;
begin
  select * into job from public.total_loss_analysis_jobs j where j.id=$1 for update;
  if not found or job.processing_token is distinct from $2 or job.run_id is distinct from $3 then
    return false;
  end if;
  if job.status = 'completed' then
    select * into stored from public.total_loss_analysis_report_evidence e where e.analysis_run_id=$3;
    return found and stored.ingestion=$5 and public.complete_total_loss_analysis($1,$2,$3,$4);
  end if;
  select * into details from public.total_loss_case_details d where d.case_id=job.case_id for update;
  if job.status <> 'processing' or job.processing_expires_at <= statement_timestamp()
    or job.source_intake_mode is distinct from 'report'
    or details.intake_mode is distinct from 'report'
    or details.analysis_input_revision is distinct from job.source_analysis_input_revision
    or details.analysis_input_id is distinct from job.source_analysis_input_id
    or details.report_last_upload_id is distinct from job.source_report_upload_id
    or not exists (select 1 from storage.objects o where o.bucket_id='case-files'
      and o.name=details.report_storage_owner_id::text||'/'||job.case_id::text||'/valuation-report.pdf'
      and o.user_metadata->>'uploadId'=job.source_report_upload_id::text)
  then return false; end if;
  if not public.complete_total_loss_analysis($1,$2,$3,$4) then return false; end if;
  insert into public.total_loss_analysis_report_evidence (
    analysis_run_id,analysis_job_id,case_id,report_upload_id,analysis_input_revision,
    analysis_input_id,ingestion,evidence_origin
  ) values ($3,job.id,job.case_id,job.source_report_upload_id,job.source_analysis_input_revision,
    job.source_analysis_input_id,$5,'analysis');
  return true;
end;
$$;
revoke all on function public.complete_total_loss_report_analysis(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.complete_total_loss_report_analysis(uuid,uuid,uuid,jsonb,jsonb) to service_role;

create function public.get_owned_total_loss_report_evidence(requested_run_id uuid, requested_user_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select e.ingestion from public.total_loss_analysis_report_evidence e
  join public.appraisal_cases c on c.id=e.case_id
  where e.analysis_run_id=$1 and c.user_id=$2;
$$;
revoke all on function public.get_owned_total_loss_report_evidence(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_owned_total_loss_report_evidence(uuid,uuid) to service_role;

-- A recovery creates a successor; failed package and work records stay immutable.
alter table public.total_loss_package_jobs
  add column supersedes_package_job_id uuid unique,
  add foreign key (supersedes_package_job_id,case_id)
    references public.total_loss_package_jobs(id,case_id) on delete restrict,
  drop constraint total_loss_package_jobs_entitlement_snapshot_key;
create unique index total_loss_package_jobs_original_entitlement_snapshot_key
on public.total_loss_package_jobs(entitlement_id,preliminary_snapshot_id)
where supersedes_package_job_id is null;
create trigger total_loss_package_jobs_recovery_identity
before update on public.total_loss_package_jobs
for each row execute function public.protect_total_loss_stable_columns('supersedes_package_job_id');

create function public.validate_total_loss_package_successor()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.supersedes_package_job_id is not null and not exists (
    select 1 from public.total_loss_package_jobs old_job
    where old_job.id=new.supersedes_package_job_id and old_job.case_id=new.case_id
      and old_job.entitlement_id=new.entitlement_id
      and old_job.preliminary_snapshot_id=new.preliminary_snapshot_id
      and old_job.status='failed' and old_job.failure_code='SOURCE_LINEAGE_CONFLICT'
      and not exists(select 1 from public.total_loss_source_snapshots s where s.package_job_id=old_job.id)
      and exists(select 1 from public.total_loss_preliminary_snapshots p
        join public.total_loss_analysis_report_evidence e on e.analysis_run_id=p.analysis_run_id
        where p.id=old_job.preliminary_snapshot_id and e.case_id=new.case_id
          and e.report_upload_id=p.source_report_upload_id
          and e.analysis_input_id=p.source_analysis_input_id
          and e.analysis_input_revision=p.source_analysis_input_revision)
  ) then
    raise exception using errcode='55000', message='Package recovery source is not eligible.';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_total_loss_package_successor() from public,anon,authenticated,service_role;
create trigger total_loss_package_jobs_validate_successor
before insert on public.total_loss_package_jobs
for each row execute function public.validate_total_loss_package_successor();

create or replace function public.resolve_total_loss_package_source_context(
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
    coalesce(extraction.normalized_report, report_evidence.ingestion),
    coalesce(extraction.provider_name, report_evidence.ingestion->>'provider'),
    coalesce(extraction.extraction_schema_version, report_evidence.ingestion->>'schemaVersion'),
    coalesce(extraction.extracted_at, report_evidence.recorded_at),
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
  left join public.total_loss_analysis_report_evidence as report_evidence
    on report_evidence.analysis_run_id=preliminary.analysis_run_id
    and report_evidence.analysis_job_id=preliminary.analysis_job_id
    and report_evidence.case_id=preliminary.case_id
    and report_evidence.report_upload_id=preliminary.source_report_upload_id
    and report_evidence.analysis_input_revision=preliminary.source_analysis_input_revision
    and report_evidence.analysis_input_id=preliminary.source_analysis_input_id
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

create or replace function public.seal_total_loss_source_snapshot(
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

    if not found then
      select e.ingestion, e.ingestion->>'provider', e.ingestion->>'schemaVersion'
      into extraction_row.normalized_report, extraction_row.provider_name, extraction_row.extraction_schema_version
      from public.total_loss_analysis_report_evidence e
      where e.analysis_run_id=preliminary_row.analysis_run_id
        and e.analysis_job_id=preliminary_row.analysis_job_id and e.case_id=package_row.case_id
        and e.report_upload_id=preliminary_row.source_report_upload_id
        and e.analysis_input_revision=preliminary_row.source_analysis_input_revision
        and e.analysis_input_id=preliminary_row.source_analysis_input_id;
    end if;
    if extraction_row.normalized_report is not null then
      extraction_wrapper := extraction_row.normalized_report;
      extraction_model := extraction_wrapper ->> 'model';

      if requested_normalized_extraction_digest is null
        or requested_normalized_extraction_digest !~ '^[0-9a-f]{64}$'
        or extraction_wrapper ->> 'documentSha256' is distinct from
          requested_source_document_sha256 then
        raise exception using errcode = '55000', message = 'Stored extraction integrity does not match the source report.';
      end if;
    else
      raise exception using errcode = '55000', message = 'Report analysis evidence is missing.';
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

create or replace function public.enqueue_total_loss_package_job(
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
    and (package_job.id=workflow_row.current_package_job_id
      or (workflow_row.current_package_job_id is null and package_job.supersedes_package_job_id is null))
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

notify pgrst, 'reload schema';
