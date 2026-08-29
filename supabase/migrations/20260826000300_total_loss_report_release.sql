-- Milestone 5: deterministic report delivery, independent release audit,
-- publication, staff exception decisions, and retained-access no-dispute refund.

-- Report validation manifests contain only JSON scalars, objects, arrays, and
-- schema-bounded integer numbers. Serialize them exactly like the backend's
-- canonical JSON contract: UTF-8, recursively sorted object keys, preserved
-- array order, and no insignificant whitespace.
create function public.total_loss_canonical_jsonb_text(requested_value jsonb)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case pg_catalog.jsonb_typeof($1)
    when 'object' then (
      select '{' || coalesce(
        pg_catalog.string_agg(
          pg_catalog.to_jsonb(item.key)::text || ':' ||
            public.total_loss_canonical_jsonb_text(item.value),
          ',' order by pg_catalog.convert_to(item.key, 'UTF8')
        ),
        ''
      ) || '}'
      from pg_catalog.jsonb_each($1) as item(key, value)
    )
    when 'array' then (
      select '[' || coalesce(
        pg_catalog.string_agg(
          public.total_loss_canonical_jsonb_text(item.value),
          ',' order by item.ordinality
        ),
        ''
      ) || ']'
      from pg_catalog.jsonb_array_elements($1) with ordinality
        as item(value, ordinality)
    )
    else $1::text
  end;
$$;

comment on function public.total_loss_canonical_jsonb_text(jsonb) is
  'Internal canonical UTF-8 JSON serializer for bounded report validation manifests.';

create function public.total_loss_canonical_jsonb_digest(requested_value jsonb)
returns text
language sql
immutable
strict
parallel safe
security definer
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        public.total_loss_canonical_jsonb_text($1),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

comment on function public.total_loss_canonical_jsonb_digest(jsonb) is
  'Service-only SHA-256 over the exact canonical full report validation manifest.';

-- Extend the package lifecycle without removing dormant Milestone 1 states.
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
      'report_generating',
      'waiting_ai_review',
      'waiting_human_review',
      'refund_pending',
      'review_required',
      'new_evidence_required',
      'retryable_failed',
      'ready',
      'not_supportable',
      'failed'
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
      status in ('processing', 'source_frozen', 'report_generating')
      and attempt_count >= 1
      and processing_token is not null
      and processing_expires_at is not null
      and failure_code is null
      and retryable is null
      and started_at is not null
      and finished_at is null
    )
    or (
      status in ('waiting_ai_review', 'waiting_human_review', 'refund_pending')
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

drop trigger total_loss_package_jobs_protect_m4_terminal
  on public.total_loss_package_jobs;
create trigger total_loss_package_jobs_protect_m4_terminal
before update or delete on public.total_loss_package_jobs
for each row execute function public.protect_total_loss_terminal_record(
  'review_required',
  'new_evidence_required',
  'ready',
  'not_supportable',
  'failed'
);

alter table public.workflow_work_items
  add column report_version_id uuid,
  add column sequence_number integer not null default 1,
  add constraint workflow_work_items_sequence_number_positive
    check (sequence_number >= 1);

alter table public.workflow_work_items
  drop constraint workflow_work_items_logical_key,
  add constraint workflow_work_items_logical_key
    unique (package_job_id, work_type, work_version, sequence_number);

create trigger workflow_work_items_protect_release_identity
before update on public.workflow_work_items
for each row execute function public.protect_total_loss_stable_columns(
  'sequence_number'
);

alter table public.total_loss_report_versions
  alter column renderer_version drop not null,
  alter column template_version drop not null,
  alter column schema_version drop not null,
  alter column report drop not null,
  alter column report_digest drop not null,
  add column package_job_id uuid,
  add column source_snapshot_id uuid,
  add column generation_work_item_id uuid,
  add column review_work_item_id uuid,
  add column source_snapshot_digest text,
  add column assessment_digest text,
  add column validation_version text,
  add column validation_manifest jsonb,
  add column pdf_digest text,
  add column pdf_byte_size bigint,
  add column generated_at timestamptz,
  add column failure_code text;

alter table public.total_loss_report_versions
  drop constraint total_loss_report_versions_versions_safe,
  drop constraint total_loss_report_versions_report_object,
  drop constraint total_loss_report_versions_digest_valid,
  drop constraint total_loss_report_versions_status_valid,
  drop constraint total_loss_report_versions_publication_complete;

alter table public.total_loss_report_versions
  add constraint total_loss_report_versions_package_work_identity_key
    unique (id, case_id, package_job_id),
  add constraint total_loss_report_versions_package_identity_fkey
    foreign key (package_job_id, case_id, preliminary_snapshot_id)
    references public.total_loss_package_jobs (id, case_id, preliminary_snapshot_id)
    on delete restrict,
  add constraint total_loss_report_versions_source_identity_fkey
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
    ) on delete restrict,
  add constraint total_loss_report_versions_generation_work_fkey
    foreign key (generation_work_item_id, package_job_id, case_id)
    references public.workflow_work_items (id, package_job_id, case_id)
    on delete restrict,
  add constraint total_loss_report_versions_review_work_fkey
    foreign key (review_work_item_id, package_job_id, case_id)
    references public.workflow_work_items (id, package_job_id, case_id)
    on delete restrict,
  add constraint total_loss_report_versions_m5_versions_safe
    check (
      source_snapshot_id is null
      or (
        renderer_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
        and template_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
        and schema_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
        and validation_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      )
    ),
  add constraint total_loss_report_versions_m5_json_valid
    check (
      source_snapshot_id is null
      or (
        (report is null or (jsonb_typeof(report) = 'object' and pg_column_size(report) <= 2097152))
        and (
          validation_manifest is null
          or (
            jsonb_typeof(validation_manifest) = 'object'
            and pg_column_size(validation_manifest) <= 262144
          )
        )
      )
    ),
  add constraint total_loss_report_versions_m5_digests_valid
    check (
      source_snapshot_id is null
      or (
        (report_digest is null or report_digest ~ '^[0-9a-f]{64}$')
        and source_snapshot_digest ~ '^[0-9a-f]{64}$'
        and assessment_digest ~ '^[0-9a-f]{64}$'
        and (pdf_digest is null or pdf_digest ~ '^[0-9a-f]{64}$')
      )
    ),
  add constraint total_loss_report_versions_m5_size_valid
    check (pdf_byte_size is null or pdf_byte_size between 1 and 52428800),
  add constraint total_loss_report_versions_failure_code_safe
    check (failure_code is null or failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  add constraint total_loss_report_versions_status_valid
    check (
      status in (
        'draft',
        'generated',
        'validated',
        'reviewing',
        'human_review_required',
        'published',
        'superseded',
        'failed'
      )
    ),
  add constraint total_loss_report_versions_publication_complete
    check (
      (
        source_snapshot_id is null
        and (
          (status = 'published' and document_id is not null and published_at is not null)
          or (status <> 'published' and published_at is null)
        )
      )
      or (
        source_snapshot_id is not null
        and package_job_id is not null
        and generation_work_item_id is not null
        and source_snapshot_digest is not null
        and assessment_digest is not null
        and (
          (
            status = 'draft'
            and renderer_version is null
            and template_version is null
            and schema_version is null
            and report is null
            and report_digest is null
            and validation_version is null
            and validation_manifest is null
            and pdf_digest is null
            and pdf_byte_size is null
            and generated_at is null
            and published_at is null
            and failure_code is null
          )
          or (
            status in (
              'generated',
              'validated',
              'reviewing',
              'human_review_required',
              'published',
              'superseded'
            )
            and document_id is not null
            and renderer_version is not null
            and template_version is not null
            and schema_version is not null
            and report is not null
            and report_digest is not null
            and validation_version is not null
            and validation_manifest is not null
            and pdf_digest is not null
            and pdf_byte_size is not null
            and generated_at is not null
            and failure_code is null
            and ((status = 'published') = (published_at is not null))
          )
          or (
            status = 'failed'
            and failure_code is not null
            and published_at is null
          )
        )
      )
    );

create unique index total_loss_report_versions_generation_work_key
  on public.total_loss_report_versions (generation_work_item_id)
  where generation_work_item_id is not null;
create unique index total_loss_report_versions_document_key
  on public.total_loss_report_versions (document_id)
  where document_id is not null;
create unique index total_loss_report_versions_exact_m5_key
  on public.total_loss_report_versions (
    report_series_id,
    final_assessment_id,
    report_digest,
    renderer_version,
    template_version,
    schema_version
  ) where source_snapshot_id is not null and report_digest is not null;

alter table public.workflow_work_items
  add constraint workflow_work_items_report_identity_key
    unique (id, case_id, report_version_id),
  add constraint workflow_work_items_report_version_fkey
    foreign key (report_version_id, case_id, package_job_id)
    references public.total_loss_report_versions (id, case_id, package_job_id)
    on delete restrict;

alter table public.total_loss_report_series
  add column current_report_version_id uuid,
  add column current_published_report_version_id uuid,
  add constraint total_loss_report_series_current_report_fkey
    foreign key (current_report_version_id, case_id, id)
    references public.total_loss_report_versions (id, case_id, report_series_id)
    on delete restrict,
  add constraint total_loss_report_series_current_published_fkey
    foreign key (current_published_report_version_id, case_id, id)
    references public.total_loss_report_versions (id, case_id, report_series_id)
    on delete restrict;

create trigger total_loss_report_series_protect_identity
before update on public.total_loss_report_series
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'product_identifier',
  'report_kind',
  'created_at'
);

create function public.protect_total_loss_report_version_m5()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
    new.id, new.case_id, new.report_series_id, new.version_number,
    new.final_assessment_id, new.preliminary_snapshot_id, new.package_job_id,
    new.source_snapshot_id, new.generation_work_item_id,
    new.source_snapshot_digest, new.assessment_digest,
    new.supersedes_report_version_id, new.created_at
  ) is distinct from row(
    old.id, old.case_id, old.report_series_id, old.version_number,
    old.final_assessment_id, old.preliminary_snapshot_id, old.package_job_id,
    old.source_snapshot_id, old.generation_work_item_id,
    old.source_snapshot_digest, old.assessment_digest,
    old.supersedes_report_version_id, old.created_at
  ) then
    raise exception using
      errcode = '55000',
      message = 'Report version lineage is immutable.';
  end if;

  if old.report is not null and row(
    new.renderer_version, new.template_version, new.schema_version,
    new.report, new.report_digest, new.validation_version,
    new.validation_manifest, new.pdf_digest, new.pdf_byte_size,
    new.generated_at, new.document_id
  ) is distinct from row(
    old.renderer_version, old.template_version, old.schema_version,
    old.report, old.report_digest, old.validation_version,
    old.validation_manifest, old.pdf_digest, old.pdf_byte_size,
    old.generated_at, old.document_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'Generated report content is immutable.';
  end if;

  if old.review_work_item_id is not null
    and new.review_work_item_id is distinct from old.review_work_item_id then
    raise exception using
      errcode = '55000',
      message = 'Report review work identity is immutable.';
  end if;

  return new;
end;
$$;

create trigger zz_total_loss_report_versions_protect_m5_identity
before update on public.total_loss_report_versions
for each row execute function public.protect_total_loss_report_version_m5();

create trigger total_loss_report_versions_protect_release_terminal
before update or delete on public.total_loss_report_versions
for each row execute function public.protect_total_loss_terminal_record(
  'superseded',
  'failed'
);

create trigger zz_total_loss_claim_documents_protect_m5_identity
before update on public.total_loss_claim_documents
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'document_kind',
  'storage_bucket_id',
  'storage_object_name',
  'original_filename',
  'created_by_user_id',
  'created_at'
);

alter table public.total_loss_ai_review_runs
  add column work_item_id uuid,
  add column source_snapshot_id uuid,
  add column attempt_number integer,
  add column assessment_digest text,
  add column report_digest text,
  add column pdf_digest text,
  add column returned_model_identifier text,
  add column processing_token uuid,
  add column processing_expires_at timestamptz,
  add column release_gate_manifest jsonb,
  add column release_gate_digest text,
  add constraint total_loss_ai_review_runs_work_fkey
    foreign key (work_item_id, case_id, report_version_id)
    references public.workflow_work_items (id, case_id, report_version_id)
    on delete restrict,
  add constraint total_loss_ai_review_runs_source_fkey
    foreign key (source_snapshot_id, case_id)
    references public.total_loss_source_snapshots (id, case_id)
    on delete restrict;

alter table public.total_loss_ai_review_runs
  drop constraint total_loss_ai_review_runs_state_complete;

alter table public.total_loss_ai_review_runs
  add constraint total_loss_ai_review_runs_attempt_positive
    check (attempt_number is null or attempt_number >= 1),
  add constraint total_loss_ai_review_runs_m5_digests_valid
    check (
      work_item_id is null
      or (
        assessment_digest ~ '^[0-9a-f]{64}$'
        and report_digest ~ '^[0-9a-f]{64}$'
        and pdf_digest ~ '^[0-9a-f]{64}$'
        and (release_gate_digest is null or release_gate_digest ~ '^[0-9a-f]{64}$')
      )
    ),
  add constraint total_loss_ai_review_runs_m5_gate_object
    check (
      release_gate_manifest is null
      or (
        jsonb_typeof(release_gate_manifest) = 'object'
        and pg_column_size(release_gate_manifest) <= 262144
      )
    ),
  add constraint total_loss_ai_review_runs_m5_returned_model_safe
    check (
      returned_model_identifier is null
      or (
        char_length(btrim(returned_model_identifier)) between 1 and 255
        and returned_model_identifier !~ '[[:cntrl:]]'
      )
    ),
  add constraint total_loss_ai_review_runs_state_complete
    check (
      (
        work_item_id is null
        and (
          (
            status = 'queued'
            and output_digest is null and review_result is null
            and recommendation is null and confidence is null
            and failure_code is null and started_at is null and completed_at is null
          )
          or (
            status = 'processing'
            and output_digest is null and review_result is null
            and recommendation is null and confidence is null
            and failure_code is null and started_at is not null and completed_at is null
          )
          or (
            status = 'completed'
            and output_digest is not null and review_result is not null
            and recommendation is not null and confidence is not null
            and failure_code is null and started_at is not null and completed_at is not null
          )
          or (
            status in ('failed', 'refused', 'timed_out')
            and output_digest is null and review_result is null
            and recommendation is null and confidence is null
            and failure_code is not null and started_at is not null and completed_at is not null
          )
        )
      )
      or (
        work_item_id is not null
        and report_version_id is not null
        and source_snapshot_id is not null
        and attempt_number is not null
        and processing_token is not null
        and started_at is not null
        and (
          (
            status = 'processing'
            and processing_expires_at is not null
            and output_digest is null and review_result is null
            and recommendation is null and confidence is null
            and returned_model_identifier is null
            and failure_code is null and completed_at is null
            and release_gate_manifest is null and release_gate_digest is null
          )
          or (
            status = 'completed'
            and processing_expires_at is null
            and output_digest is not null and review_result is not null
            and recommendation is not null and confidence is not null
            and returned_model_identifier is not null
            and failure_code is null and completed_at is not null
            and release_gate_manifest is not null and release_gate_digest is not null
          )
          or (
            status in ('failed', 'refused', 'timed_out')
            and processing_expires_at is null
            and output_digest is null and review_result is null
            and recommendation is null and confidence is null
            and failure_code is not null and completed_at is not null
          )
        )
      )
    );

create unique index total_loss_ai_review_runs_attempt_key
  on public.total_loss_ai_review_runs (report_version_id, input_digest, attempt_number)
  where work_item_id is not null;
create unique index total_loss_ai_review_runs_one_completed_input_key
  on public.total_loss_ai_review_runs (report_version_id, input_digest)
  where work_item_id is not null and status = 'completed';

create or replace function public.protect_total_loss_ai_review_run()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'AI review runs cannot be deleted.';
  end if;

  if row(
    new.id, new.case_id, new.final_assessment_id, new.report_version_id,
    new.work_item_id, new.source_snapshot_id, new.attempt_number,
    new.provider_identifier, new.model_identifier, new.prompt_version,
    new.schema_version, new.input_digest, new.assessment_digest,
    new.report_digest, new.pdf_digest, new.processing_token, new.created_at
  ) is distinct from row(
    old.id, old.case_id, old.final_assessment_id, old.report_version_id,
    old.work_item_id, old.source_snapshot_id, old.attempt_number,
    old.provider_identifier, old.model_identifier, old.prompt_version,
    old.schema_version, old.input_digest, old.assessment_digest,
    old.report_digest, old.pdf_digest, old.processing_token, old.created_at
  ) then
    raise exception using errcode = '55000', message = 'AI review input identity is immutable.';
  end if;

  if old.status in ('completed', 'failed', 'refused', 'timed_out') then
    raise exception using errcode = '55000', message = 'Terminal AI review runs are immutable.';
  end if;

  return new;
end;
$$;

alter table public.total_loss_release_reviews
  alter column ai_review_run_id drop not null,
  add column report_version_id uuid,
  add column final_assessment_id uuid,
  add column resulting_report_version_id uuid,
  add column refund_request_id uuid,
  add column decision_digest text,
  add constraint total_loss_release_reviews_report_fkey
    foreign key (report_version_id, case_id, final_assessment_id)
    references public.total_loss_report_versions (id, case_id, final_assessment_id)
    on delete restrict,
  add constraint total_loss_release_reviews_result_report_fkey
    foreign key (resulting_report_version_id, case_id)
    references public.total_loss_report_versions (id, case_id)
    on delete restrict,
  add constraint total_loss_release_reviews_refund_fkey
    foreign key (refund_request_id, case_id)
    references public.commerce_refund_requests (id, case_id)
    on delete restrict;

alter table public.total_loss_release_reviews
  drop constraint total_loss_release_reviews_decision_valid,
  add constraint total_loss_release_reviews_decision_valid
    check (
      decision is null
      or decision in (
        'approved',
        'revision_requested',
        'not_supportable',
        'new_evidence_required'
      )
    ),
  add constraint total_loss_release_reviews_m5_lineage_complete
    check (
      report_version_id is null
      or final_assessment_id is not null
    ),
  add constraint total_loss_release_reviews_decision_digest_valid
    check (decision_digest is null or decision_digest ~ '^[0-9a-f]{64}$');

drop trigger total_loss_release_reviews_protect_identity
  on public.total_loss_release_reviews;
create trigger total_loss_release_reviews_protect_identity
before update on public.total_loss_release_reviews
for each row execute function public.protect_total_loss_stable_columns(
  'id',
  'case_id',
  'ai_review_run_id',
  'report_version_id',
  'final_assessment_id',
  'created_at'
);

create unique index total_loss_release_reviews_one_active_report_idx
  on public.total_loss_release_reviews (report_version_id)
  where report_version_id is not null and status in ('queued', 'in_review');
create unique index total_loss_release_reviews_result_report_idx
  on public.total_loss_release_reviews (resulting_report_version_id)
  where resulting_report_version_id is not null;

create function public.validate_total_loss_release_review_result_m5()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reviewed_report public.total_loss_report_versions%rowtype;
  resulting_report public.total_loss_report_versions%rowtype;
begin
  if tg_op = 'UPDATE'
    and old.resulting_report_version_id is not null
    and new.resulting_report_version_id is distinct from
      old.resulting_report_version_id
  then
    raise exception using
      errcode = '55000',
      message = 'Release-review replacement report identity is immutable.';
  end if;

  if new.resulting_report_version_id is null then
    if new.status = 'resolved' and new.decision = 'revision_requested' then
      raise exception using
        errcode = '23514',
        message = 'Resolved revision reviews require a replacement report version.';
    end if;
    return new;
  end if;

  if new.status <> 'resolved' or new.decision <> 'revision_requested' then
    raise exception using
      errcode = '23514',
      message = 'Only resolved revision reviews may reference a replacement report version.';
  end if;

  select report_version.* into reviewed_report
  from public.total_loss_report_versions as report_version
  where report_version.id = new.report_version_id
    and report_version.case_id = new.case_id;
  select report_version.* into resulting_report
  from public.total_loss_report_versions as report_version
  where report_version.id = new.resulting_report_version_id
    and report_version.case_id = new.case_id;

  if reviewed_report.id is null
    or resulting_report.id is null
    or resulting_report.id = reviewed_report.id
    or resulting_report.report_series_id is distinct from
      reviewed_report.report_series_id
    or resulting_report.supersedes_report_version_id is distinct from
      reviewed_report.id
  then
    raise exception using
      errcode = '23514',
      message = 'Release-review replacement report lineage is invalid.';
  end if;

  return new;
end;
$$;

create trigger total_loss_release_reviews_validate_m5_result
before insert or update on public.total_loss_release_reviews
for each row execute function public.validate_total_loss_release_review_result_m5();

revoke execute on function public.validate_total_loss_release_review_result_m5()
  from public, anon, authenticated, service_role;

-- Private immutable generated deliverables. Browser roles receive SELECT only
-- through the exact published-owner or staff policies below.
insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'case-deliverables', 'case-deliverables', false, 52428800,
  array['application/pdf']::text[]
) on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy "Permanent owners can read their ready claim documents"
  on public.total_loss_claim_documents;
create policy "Permanent owners can read their ready claim documents"
on public.total_loss_claim_documents
for select
to authenticated
using (
  status = 'ready'
  and (select public.is_permanent_total_loss_case_owner(case_id))
  and exists (
    select 1
    from public.total_loss_report_versions as report_version
    where report_version.document_id = total_loss_claim_documents.id
      and report_version.case_id = total_loss_claim_documents.case_id
      and report_version.status = 'published'
  )
);

create function public.authorize_total_loss_deliverable_read(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.total_loss_claim_documents as document
    join public.total_loss_report_versions as report_version
      on report_version.document_id = document.id
      and report_version.case_id = document.case_id
      and report_version.status = 'published'
    where document.storage_bucket_id = 'case-deliverables'
      and document.storage_object_name = $1
      and document.status = 'ready'
      and public.is_permanent_total_loss_case_owner(document.case_id)
  );
$$;

revoke execute on function public.authorize_total_loss_deliverable_read(text)
  from public, anon, service_role;
grant execute on function public.authorize_total_loss_deliverable_read(text)
  to authenticated;

create function public.authorize_staff_total_loss_deliverable_read(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_venfour_staff()
    and exists (
      select 1
      from public.total_loss_claim_documents as document
      join public.total_loss_report_versions as report_version
        on report_version.document_id = document.id
        and report_version.case_id = document.case_id
      where document.storage_bucket_id = 'case-deliverables'
        and document.storage_object_name = $1
        and document.status = 'ready'
    );
$$;

revoke execute on function public.authorize_staff_total_loss_deliverable_read(text)
  from public, anon, service_role;
grant execute on function public.authorize_staff_total_loss_deliverable_read(text)
  to authenticated;

create policy "Owners can read published total-loss deliverables"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'case-deliverables'
  and public.authorize_total_loss_deliverable_read(name)
);

create policy "Total-loss review deliverable reads"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'case-deliverables'
  and public.authorize_staff_total_loss_deliverable_read(name)
);

create function public.protect_total_loss_sealed_deliverable_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.bucket_id = 'case-deliverables'
    and exists (
      select 1
      from public.total_loss_claim_documents as document
      where document.storage_bucket_id = old.bucket_id
        and document.storage_object_name = old.name
        and document.status = 'ready'
    ) then
    raise exception using
      errcode = '55000',
      message = 'Sealed total-loss deliverable objects are immutable.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function public.protect_total_loss_sealed_deliverable_object()
  from public, anon, authenticated, service_role;

create trigger total_loss_deliverable_objects_protect_sealed
before update or delete on storage.objects
for each row execute function public.protect_total_loss_sealed_deliverable_object();

-- Durable report work starts only after the immutable assessment is complete.
create function public.enqueue_total_loss_report_generation(
  requested_package_job_id uuid
)
returns table (
  outcome text,
  case_id uuid,
  package_job_id uuid,
  work_item_id uuid,
  work_type text,
  work_version text,
  work_item_status text,
  workflow_revision bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  package_row public.total_loss_package_jobs%rowtype;
  assessment_row public.total_loss_final_assessments%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  order_row public.commerce_orders%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  work_row public.workflow_work_items%rowtype;
  created_work boolean := false;
begin
  if requested_package_job_id is null then
    raise exception using errcode = '22023', message = 'Package job identifier is required.';
  end if;

  select package_job.* into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = requested_package_job_id
  for update;
  if not found then return; end if;

  select final_assessment.* into assessment_row
  from public.total_loss_final_assessments as final_assessment
  where final_assessment.package_job_id = package_row.id
    and final_assessment.case_id = package_row.case_id;

  select entitlement.* into entitlement_row
  from public.case_entitlements as entitlement
  where entitlement.id = package_row.entitlement_id
    and entitlement.case_id = package_row.case_id
  for update;

  select commerce_order.* into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.id = entitlement_row.order_id
    and commerce_order.case_id = entitlement_row.case_id
  for update;

  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = package_row.case_id
  for update;

  if assessment_row.id is null
    or assessment_row.source_snapshot_id is null
    or workflow_row.case_id is null
    or workflow_row.current_package_job_id is distinct from package_row.id
    or workflow_row.preliminary_snapshot_id is distinct from package_row.preliminary_snapshot_id
    or package_row.status <> 'assessment_ready'
    or not (
      (entitlement_row.status = 'active' and order_row.status in ('paid', 'partially_refunded'))
      or (
        entitlement_row.status = 'refunded_access_retained'
        and order_row.status = 'refunded'
      )
    )
  then
    raise exception using errcode = '55000', message = 'Package is not eligible for report generation.';
  end if;

  select work_item.* into work_row
  from public.workflow_work_items as work_item
  where work_item.package_job_id = package_row.id
    and work_item.work_type = 'total_loss_report_generate'
  order by work_item.sequence_number desc
  limit 1
  for update;

  if not found or work_row.status in ('completed', 'terminal_failed') then
    insert into public.workflow_work_items (
      case_id, package_job_id, work_type, work_version,
      sequence_number, status, next_attempt_at
    ) values (
      package_row.case_id, package_row.id,
      'total_loss_report_generate', '1',
      coalesce(work_row.sequence_number, 0) + 1,
      'queued', statement_timestamp()
    ) returning * into work_row;
    created_work := true;
  end if;

  if workflow_row.current_task is distinct from 'report_generation_queued' then
    update public.total_loss_claim_workflows as workflow
    set current_task = 'report_generation_queued',
        revision = workflow.revision + 1
    where workflow.case_id = workflow_row.case_id
      and workflow.revision = workflow_row.revision
    returning * into workflow_row;
    if not found then
      raise exception using errcode = '40001', message = 'Claim workflow changed while queuing report generation.';
    end if;
  end if;

  return query select
    case when created_work then 'created' else 'existing' end,
    package_row.case_id, package_row.id, work_row.id,
    work_row.work_type, work_row.work_version, work_row.status,
    workflow_row.revision;
end;
$$;

comment on function public.enqueue_total_loss_report_generation(uuid) is
  'Service-only idempotent transition from one frozen final assessment to durable report-generation work.';

create function public.resolve_workflow_work_item_kind(
  requested_work_item_id uuid
)
returns table (
  work_item_id uuid,
  case_id uuid,
  package_job_id uuid,
  report_version_id uuid,
  work_type text,
  work_version text,
  sequence_number integer,
  work_item_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    work_item.id, work_item.case_id, work_item.package_job_id,
    work_item.report_version_id, work_item.work_type,
    work_item.work_version, work_item.sequence_number, work_item.status
  from public.workflow_work_items as work_item
  where work_item.id = $1;
$$;

comment on function public.resolve_workflow_work_item_kind(uuid) is
  'Service-only minimal work discriminator for the generic internal worker endpoint.';

create function public.claim_total_loss_report_generation_work_item(
  requested_work_item_id uuid,
  requested_processing_token uuid
)
returns table (
  outcome text,
  case_id uuid,
  package_job_id uuid,
  work_item_id uuid,
  work_item_status text,
  package_status text,
  attempt_count integer,
  processing_token uuid,
  processing_expires_at timestamptz,
  report_series_id uuid,
  report_version_id uuid,
  report_version_number integer,
  document_id uuid,
  storage_bucket_id text,
  storage_object_name text,
  original_filename text,
  generated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  work_row public.workflow_work_items%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  assessment_row public.total_loss_final_assessments%rowtype;
  source_row public.total_loss_source_snapshots%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  order_row public.commerce_orders%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  series_row public.total_loss_report_series%rowtype;
  report_row public.total_loss_report_versions%rowtype;
  document_row public.total_loss_claim_documents%rowtype;
  lease_expires_at timestamptz := statement_timestamp() + interval '30 minutes';
  next_version integer;
  report_version_identifier uuid;
  filename text := 'valuation-evidence-package.pdf';
begin
  if requested_work_item_id is null or requested_processing_token is null then
    raise exception using errcode = '22023', message = 'Work item and processing token are required.';
  end if;

  select work_item.* into work_row
  from public.workflow_work_items as work_item
  where work_item.id = requested_work_item_id
  for update;
  if not found then return; end if;

  if work_row.work_type <> 'total_loss_report_generate' or work_row.work_version <> '1' then
    raise exception using errcode = '22023', message = 'Work item is not report-generation work.';
  end if;

  select package_job.* into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = work_row.package_job_id
    and package_job.case_id = work_row.case_id
  for update;

  select final_assessment.* into assessment_row
  from public.total_loss_final_assessments as final_assessment
  where final_assessment.package_job_id = package_row.id;
  select source_snapshot.* into source_row
  from public.total_loss_source_snapshots as source_snapshot
  where source_snapshot.id = assessment_row.source_snapshot_id;

  select entitlement.* into entitlement_row
  from public.case_entitlements as entitlement
  where entitlement.id = package_row.entitlement_id for update;
  select commerce_order.* into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.id = entitlement_row.order_id for update;
  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = package_row.case_id for update;

  if work_row.report_version_id is not null then
    select report_version.* into report_row
    from public.total_loss_report_versions as report_version
    where report_version.id = work_row.report_version_id
      and report_version.generation_work_item_id = work_row.id;
    select report_series.* into series_row
    from public.total_loss_report_series as report_series
    where report_series.id = report_row.report_series_id;
    select document.* into document_row
    from public.total_loss_claim_documents as document
    where document.id = report_row.document_id;
  end if;

  if work_row.status = 'completed' then
    return query select 'completed'::text, work_row.case_id, package_row.id,
      work_row.id, work_row.status, package_row.status, work_row.attempt_count,
      work_row.processing_token, work_row.processing_expires_at,
      series_row.id, report_row.id, report_row.version_number, document_row.id,
      document_row.storage_bucket_id, document_row.storage_object_name,
      document_row.original_filename, coalesce(report_row.generated_at, report_row.created_at);
    return;
  end if;
  if work_row.status = 'terminal_failed' then
    return query select 'terminal_failed'::text, work_row.case_id, package_row.id,
      work_row.id, work_row.status, package_row.status, work_row.attempt_count,
      work_row.processing_token, work_row.processing_expires_at,
      series_row.id, report_row.id, report_row.version_number, document_row.id,
      document_row.storage_bucket_id, document_row.storage_object_name,
      document_row.original_filename, coalesce(report_row.generated_at, report_row.created_at);
    return;
  end if;
  if work_row.status = 'retryable_failed' and work_row.attempt_count >= 3 then
    perform public.fail_total_loss_report_work_item(
      work_row.id,
      work_row.processing_token,
      work_row.last_error_code,
      'retryable',
      1
    );
    select work_item.* into work_row
    from public.workflow_work_items as work_item
    where work_item.id = requested_work_item_id;
    select package_job.* into package_row
    from public.total_loss_package_jobs as package_job
    where package_job.id = work_row.package_job_id;
    select report_version.* into report_row
    from public.total_loss_report_versions as report_version
    where report_version.id = work_row.report_version_id;
    return query select 'terminal_failed'::text, work_row.case_id, package_row.id,
      work_row.id, work_row.status, package_row.status, work_row.attempt_count,
      work_row.processing_token, work_row.processing_expires_at,
      series_row.id, report_row.id, report_row.version_number, document_row.id,
      document_row.storage_bucket_id, document_row.storage_object_name,
      document_row.original_filename, coalesce(report_row.generated_at, report_row.created_at);
    return;
  end if;
  if work_row.status = 'retryable_failed'
    and work_row.next_attempt_at > statement_timestamp() then
    return query select 'busy'::text, work_row.case_id, package_row.id,
      work_row.id, work_row.status, package_row.status, work_row.attempt_count,
      work_row.processing_token, work_row.processing_expires_at,
      series_row.id, report_row.id, report_row.version_number, document_row.id,
      document_row.storage_bucket_id, document_row.storage_object_name,
      document_row.original_filename, coalesce(report_row.generated_at, report_row.created_at);
    return;
  end if;
  if work_row.status = 'processing'
    and work_row.processing_expires_at > statement_timestamp()
    and work_row.processing_token is distinct from requested_processing_token then
    return query select 'busy'::text, work_row.case_id, package_row.id,
      work_row.id, work_row.status, package_row.status, work_row.attempt_count,
      work_row.processing_token, work_row.processing_expires_at,
      series_row.id, report_row.id, report_row.version_number, document_row.id,
      document_row.storage_bucket_id, document_row.storage_object_name,
      document_row.original_filename, coalesce(report_row.generated_at, report_row.created_at);
    return;
  end if;

  if assessment_row.id is null or source_row.id is null
    or workflow_row.current_package_job_id is distinct from package_row.id
    or not (
      package_row.status in ('assessment_ready', 'report_generating', 'retryable_failed')
      and work_row.status in ('queued', 'dispatching', 'retryable_failed', 'processing')
    )
    or not (
      (entitlement_row.status = 'active' and order_row.status in ('paid', 'partially_refunded'))
      or (entitlement_row.status = 'refunded_access_retained' and order_row.status = 'refunded')
    )
  then
    raise exception using errcode = '55000', message = 'Report-generation work is not claimable.';
  end if;

  update public.workflow_work_items as work_item
  set status = 'processing',
      attempt_count = case
        when work_item.status = 'processing' and work_item.processing_token = requested_processing_token
          then work_item.attempt_count
        else work_item.attempt_count + 1
      end,
      dispatch_token = null, dispatch_expires_at = null,
      processing_token = requested_processing_token,
      processing_expires_at = lease_expires_at,
      last_error_code = null, retryable = null,
      completed_at = null, failed_at = null
  where work_item.id = work_row.id
  returning * into work_row;

  update public.total_loss_package_jobs as package_job
  set status = 'report_generating',
      attempt_count = case
        when package_job.status = 'report_generating'
          and package_job.processing_token = requested_processing_token
          then package_job.attempt_count
        else package_job.attempt_count + 1
      end,
      processing_token = requested_processing_token,
      processing_expires_at = lease_expires_at,
      failure_code = null, retryable = null,
      started_at = coalesce(package_job.started_at, statement_timestamp()),
      finished_at = null
  where package_job.id = package_row.id
  returning * into package_row;

  if report_row.id is null then
    insert into public.total_loss_report_series (
      case_id, product_identifier, report_kind
    ) values (
      package_row.case_id, entitlement_row.product_identifier,
      'valuation-evidence-package'
    ) on conflict on constraint total_loss_report_series_logical_key do update
      set product_identifier = excluded.product_identifier
    returning * into series_row;

    select coalesce(max(report_version.version_number), 0) + 1 into next_version
    from public.total_loss_report_versions as report_version
    where report_version.report_series_id = series_row.id;

    report_version_identifier := gen_random_uuid();

    insert into public.total_loss_claim_documents (
      case_id, document_kind, storage_bucket_id, storage_object_name,
      original_filename, media_type, status
    ) values (
      package_row.case_id, 'valuation_evidence_report', 'case-deliverables',
      'cases/' || package_row.case_id::text || '/reports/' || series_row.id::text ||
        '/versions/' || report_version_identifier::text || '/' || filename,
      filename, 'application/pdf', 'pending'
    ) returning * into document_row;

    insert into public.total_loss_report_versions (
      id, case_id, report_series_id, version_number, final_assessment_id,
      preliminary_snapshot_id, document_id, package_job_id, source_snapshot_id,
      generation_work_item_id, source_snapshot_digest, assessment_digest,
      status, supersedes_report_version_id
    ) values (
      report_version_identifier, package_row.case_id, series_row.id,
      next_version, assessment_row.id,
      package_row.preliminary_snapshot_id, document_row.id, package_row.id,
      source_row.id, work_row.id, source_row.snapshot_digest,
      assessment_row.assessment_digest, 'draft',
      series_row.current_report_version_id
    ) returning * into report_row;

    update public.workflow_work_items as work_item
    set report_version_id = report_row.id
    where work_item.id = work_row.id
    returning * into work_row;

    update public.total_loss_report_series as report_series
    set current_report_version_id = report_row.id
    where report_series.id = series_row.id
    returning * into series_row;
  end if;

  update public.total_loss_claim_workflows as workflow
  set current_report_version_id = report_row.id,
      current_task = 'report_generating',
      revision = workflow.revision + 1
  where workflow.case_id = workflow_row.case_id
    and (
      workflow.current_report_version_id is distinct from report_row.id
      or workflow.current_task is distinct from 'report_generating'
    );

  return query select 'claimed'::text, work_row.case_id, package_row.id,
    work_row.id, work_row.status, package_row.status, work_row.attempt_count,
    work_row.processing_token, work_row.processing_expires_at,
    series_row.id, report_row.id, report_row.version_number, document_row.id,
    document_row.storage_bucket_id, document_row.storage_object_name,
    document_row.original_filename, report_row.created_at;
end;
$$;

comment on function public.claim_total_loss_report_generation_work_item(uuid, uuid) is
  'Dual-fenced report-generation claim that reserves stable report, document, object-path, version, and generation-time identities before rendering.';

create function public.resolve_total_loss_report_generation_context(
  requested_work_item_id uuid,
  requested_processing_token uuid
)
returns table (
  case_id uuid,
  package_job_id uuid,
  entitlement_id uuid,
  work_item_id uuid,
  report_series_id uuid,
  report_version_id uuid,
  report_version_number integer,
  document_id uuid,
  storage_bucket_id text,
  storage_object_name text,
  original_filename text,
  generated_at timestamptz,
  source_snapshot_id uuid,
  source_snapshot_digest text,
  source_snapshot jsonb,
  final_assessment_id uuid,
  assessment_digest text,
  final_assessment jsonb,
  preliminary_snapshot_id uuid,
  preliminary_snapshot jsonb,
  product_identifier text,
  product_version text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    work_item.case_id,
    work_item.package_job_id,
    package_job.entitlement_id,
    work_item.id,
    report_version.report_series_id,
    report_version.id,
    report_version.version_number,
    document.id,
    document.storage_bucket_id,
    document.storage_object_name,
    document.original_filename,
    report_version.created_at,
    source_snapshot.id,
    source_snapshot.snapshot_digest,
    source_snapshot.source_snapshot,
    final_assessment.id,
    final_assessment.assessment_digest,
    final_assessment.assessment,
    preliminary_snapshot.id,
    preliminary_snapshot.snapshot,
    entitlement.product_identifier,
    entitlement.product_version
  from public.workflow_work_items as work_item
  join public.total_loss_package_jobs as package_job
    on package_job.id = work_item.package_job_id
    and package_job.case_id = work_item.case_id
    and package_job.processing_token = $2
    and package_job.processing_expires_at > statement_timestamp()
  join public.total_loss_report_versions as report_version
    on report_version.id = work_item.report_version_id
    and report_version.generation_work_item_id = work_item.id
    and report_version.package_job_id = work_item.package_job_id
  join public.total_loss_claim_documents as document
    on document.id = report_version.document_id
    and document.case_id = work_item.case_id
  join public.total_loss_final_assessments as final_assessment
    on final_assessment.id = report_version.final_assessment_id
    and final_assessment.package_job_id = work_item.package_job_id
  join public.total_loss_source_snapshots as source_snapshot
    on source_snapshot.id = report_version.source_snapshot_id
    and source_snapshot.id = final_assessment.source_snapshot_id
  join public.total_loss_preliminary_snapshots as preliminary_snapshot
    on preliminary_snapshot.id = report_version.preliminary_snapshot_id
    and preliminary_snapshot.case_id = work_item.case_id
  join public.case_entitlements as entitlement
    on entitlement.id = package_job.entitlement_id
    and entitlement.case_id = work_item.case_id
  where work_item.id = $1
    and work_item.work_type = 'total_loss_report_generate'
    and work_item.work_version = '1'
    and work_item.status = 'processing'
    and work_item.processing_token = $2
    and work_item.processing_expires_at > statement_timestamp()
    and report_version.status = 'draft';
$$;

comment on function public.resolve_total_loss_report_generation_context(uuid, uuid) is
  'Service-only active-lease projection of immutable report inputs and the reserved output identity.';

create function public.complete_total_loss_report_generation(
  requested_work_item_id uuid,
  requested_processing_token uuid,
  requested_report jsonb,
  requested_report_digest text,
  requested_renderer_version text,
  requested_template_version text,
  requested_schema_version text,
  requested_validation_version text,
  requested_validation_manifest jsonb,
  requested_pdf_byte_size bigint,
  requested_pdf_digest text
)
returns table (
  outcome text,
  case_id uuid,
  package_job_id uuid,
  generation_work_item_id uuid,
  review_work_item_id uuid,
  report_version_id uuid,
  document_id uuid,
  report_status text,
  package_status text,
  workflow_task text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  work_row public.workflow_work_items%rowtype;
  review_work_row public.workflow_work_items%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  report_row public.total_loss_report_versions%rowtype;
  document_row public.total_loss_claim_documents%rowtype;
  source_row public.total_loss_source_snapshots%rowtype;
  assessment_row public.total_loss_final_assessments%rowtype;
  object_row storage.objects%rowtype;
  next_review_sequence integer;
  embedded_generated_at timestamptz;
begin
  if requested_work_item_id is null
    or requested_processing_token is null
    or requested_report is null or jsonb_typeof(requested_report) <> 'object'
    or pg_column_size(requested_report) > 2097152
    or requested_report_digest !~ '^[0-9a-f]{64}$'
    or requested_pdf_digest !~ '^[0-9a-f]{64}$'
    or requested_pdf_byte_size not between 1 and 52428800
    or requested_renderer_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or requested_template_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or requested_schema_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or requested_validation_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or requested_validation_manifest is null
    or jsonb_typeof(requested_validation_manifest) <> 'object'
    or pg_column_size(requested_validation_manifest) > 262144
  then
    raise exception using errcode = '22023', message = 'Generated report result is invalid.';
  end if;

  select work_item.* into work_row
  from public.workflow_work_items as work_item
  where work_item.id = requested_work_item_id
  for update;
  if not found then return; end if;

  select package_job.* into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = work_row.package_job_id
    and package_job.case_id = work_row.case_id
  for update;
  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = work_row.case_id
  for update;
  select report_version.* into report_row
  from public.total_loss_report_versions as report_version
  where report_version.id = work_row.report_version_id
    and report_version.generation_work_item_id = work_row.id
  for update;
  select document.* into document_row
  from public.total_loss_claim_documents as document
  where document.id = report_row.document_id
  for update;
  select source_snapshot.* into source_row
  from public.total_loss_source_snapshots as source_snapshot
  where source_snapshot.id = report_row.source_snapshot_id;
  select final_assessment.* into assessment_row
  from public.total_loss_final_assessments as final_assessment
  where final_assessment.id = report_row.final_assessment_id;

  if work_row.status = 'completed' then
    if report_row.report_digest is distinct from requested_report_digest
      or report_row.pdf_digest is distinct from requested_pdf_digest
      or report_row.report is distinct from requested_report
      or report_row.validation_manifest is distinct from requested_validation_manifest then
      raise exception using errcode = '55000', message = 'Completed generation was replayed with different output.';
    end if;
    select review_item.* into review_work_row
    from public.workflow_work_items as review_item
    where review_item.id = report_row.review_work_item_id;
    return query select 'existing'::text, work_row.case_id, package_row.id,
      work_row.id, review_work_row.id, report_row.id, document_row.id,
      report_row.status, package_row.status, workflow_row.current_task;
    return;
  end if;

  if work_row.work_type <> 'total_loss_report_generate'
    or work_row.work_version <> '1'
    or work_row.status <> 'processing'
    or work_row.processing_token is distinct from requested_processing_token
    or work_row.processing_expires_at <= statement_timestamp()
    or package_row.status <> 'report_generating'
    or package_row.processing_token is distinct from requested_processing_token
    or package_row.processing_expires_at <= statement_timestamp()
    or workflow_row.current_package_job_id is distinct from package_row.id
    or workflow_row.current_report_version_id is distinct from report_row.id
    or report_row.status <> 'draft'
    or document_row.status <> 'pending'
    or document_row.storage_bucket_id is distinct from 'case-deliverables'
    or document_row.storage_object_name is distinct from
      'cases/' || report_row.case_id::text || '/reports/' ||
      report_row.report_series_id::text || '/versions/' || report_row.id::text ||
      '/valuation-evidence-package.pdf'
    or document_row.original_filename is distinct from
      'valuation-evidence-package.pdf'
    or source_row.snapshot_digest is distinct from report_row.source_snapshot_digest
    or assessment_row.assessment_digest is distinct from report_row.assessment_digest
  then
    raise exception using errcode = '55000', message = 'Report-generation completion fence is stale.';
  end if;

  begin
    embedded_generated_at := (requested_report #>> '{identity,generatedAt}')::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'Report generatedAt is invalid.';
  end;

  if requested_report ->> 'schemaVersion' is distinct from requested_schema_version
    or requested_report ->> 'reportDigest' is distinct from requested_report_digest
    or requested_report #>> '{identity,caseId}' is distinct from report_row.case_id::text
    or requested_report #>> '{identity,reportSeriesId}' is distinct from report_row.report_series_id::text
    or requested_report #>> '{identity,reportVersionId}' is distinct from report_row.id::text
    or requested_report #>> '{identity,finalAssessmentId}' is distinct from report_row.final_assessment_id::text
    or requested_report #>> '{identity,versionNumber}' is distinct from report_row.version_number::text
    or embedded_generated_at is distinct from report_row.created_at
    or requested_report #>> '{lineage,sourceSnapshotId}' is distinct from report_row.source_snapshot_id::text
    or requested_report #>> '{lineage,finalAssessmentId}' is distinct from report_row.final_assessment_id::text
    or requested_report #>> '{lineage,sourceSnapshotDigest}' is distinct from report_row.source_snapshot_digest
    or requested_report #>> '{lineage,finalAssessmentDigest}' is distinct from report_row.assessment_digest
    or requested_validation_manifest ->> 'schemaVersion' is distinct from requested_validation_version
    or requested_validation_manifest ->> 'status' is distinct from 'PASS'
    or requested_validation_manifest ->> 'reportVersionId' is distinct from report_row.id::text
    or requested_validation_manifest ->> 'reportDigest' is distinct from requested_report_digest
    or requested_validation_manifest ->> 'rendererVersion' is distinct from requested_renderer_version
    or requested_validation_manifest ->> 'templateVersion' is distinct from requested_template_version
    or requested_validation_manifest ->> 'filename' is distinct from document_row.original_filename
    or requested_validation_manifest ->> 'mediaType' is distinct from 'application/pdf'
    or requested_validation_manifest ->> 'pdfSha256' is distinct from requested_pdf_digest
    or requested_validation_manifest ->> 'byteSize' is distinct from requested_pdf_byte_size::text
    or requested_validation_manifest ->> 'manifestDigest' !~ '^[0-9a-f]{64}$'
    or requested_validation_manifest ->> 'manifestDigest' is distinct from
      public.total_loss_canonical_jsonb_digest(
        requested_validation_manifest - 'manifestDigest'
      )
  then
    raise exception using errcode = '55000', message = 'Generated report lineage or validation manifest conflicts with its reservation.';
  end if;

  select stored_object.* into object_row
  from storage.objects as stored_object
  where stored_object.bucket_id = document_row.storage_bucket_id
    and stored_object.name = document_row.storage_object_name
  for update;

  if object_row.id is null
    or object_row.metadata ->> 'mimetype' is distinct from 'application/pdf'
    or (object_row.metadata ->> 'size')::bigint is distinct from requested_pdf_byte_size
    or object_row.user_metadata ->> 'sha256' is distinct from requested_pdf_digest
  then
    raise exception using errcode = '55000', message = 'Uploaded report object metadata does not match the sealed result.';
  end if;

  update public.total_loss_claim_documents as document
  set status = 'ready', byte_size = requested_pdf_byte_size,
      content_digest = requested_pdf_digest, sealed_at = statement_timestamp(),
      failure_code = null
  where document.id = document_row.id
    and document.status = 'pending'
  returning * into document_row;
  if not found then
    raise exception using errcode = '55000', message = 'Report document seal raced with another transition.';
  end if;

  update public.total_loss_report_versions as report_version
  set renderer_version = requested_renderer_version,
      template_version = requested_template_version,
      schema_version = requested_schema_version,
      report = requested_report,
      report_digest = requested_report_digest,
      validation_version = requested_validation_version,
      validation_manifest = requested_validation_manifest,
      pdf_digest = requested_pdf_digest,
      pdf_byte_size = requested_pdf_byte_size,
      generated_at = report_version.created_at,
      status = 'validated'
  where report_version.id = report_row.id
    and report_version.status = 'draft'
  returning * into report_row;
  if not found then
    raise exception using errcode = '55000', message = 'Report version seal raced with another transition.';
  end if;

  select coalesce(max(work_item.sequence_number), 0) + 1 into next_review_sequence
  from public.workflow_work_items as work_item
  where work_item.package_job_id = package_row.id
    and work_item.work_type = 'total_loss_report_review';

  insert into public.workflow_work_items (
    case_id, package_job_id, report_version_id, work_type, work_version,
    sequence_number, status, next_attempt_at
  ) values (
    package_row.case_id, package_row.id, report_row.id,
    'total_loss_report_review', '1', next_review_sequence,
    'queued', statement_timestamp()
  ) returning * into review_work_row;

  update public.total_loss_report_versions as report_version
  set review_work_item_id = review_work_row.id
  where report_version.id = report_row.id
  returning * into report_row;

  update public.workflow_work_items as work_item
  set status = 'completed', processing_expires_at = null,
      last_error_code = null, retryable = null,
      completed_at = statement_timestamp(), failed_at = null
  where work_item.id = work_row.id
    and work_item.processing_token = requested_processing_token;
  if not found then
    raise exception using errcode = '55000', message = 'Generation work completion fence changed.';
  end if;

  update public.total_loss_package_jobs as package_job
  set status = 'waiting_ai_review', processing_expires_at = null,
      failure_code = null, retryable = null, finished_at = null
  where package_job.id = package_row.id
    and package_job.processing_token = requested_processing_token
  returning * into package_row;
  if not found then
    raise exception using errcode = '55000', message = 'Package completion fence changed.';
  end if;

  update public.total_loss_claim_workflows as workflow
  set current_task = 'report_review_queued', revision = workflow.revision + 1
  where workflow.case_id = workflow_row.case_id
    and workflow.revision = workflow_row.revision;
  if not found then
    raise exception using errcode = '40001', message = 'Claim workflow changed during report completion.';
  end if;

  insert into public.total_loss_workflow_events (
    case_id, event_type, actor_type, associated_entity_type,
    associated_entity_id, client_request_id, details
  ) values (
    package_row.case_id, 'report.generated', 'system',
    'total_loss_report_version', report_row.id, work_row.id,
    jsonb_build_object('reportVersion', report_row.version_number)
  );

  return query select 'completed'::text, work_row.case_id, package_row.id,
    work_row.id, review_work_row.id, report_row.id, document_row.id,
    report_row.status, package_row.status, 'report_review_queued'::text;
end;
$$;

comment on function public.complete_total_loss_report_generation(
  uuid, uuid, jsonb, text, text, text, text, text, jsonb, bigint, text
) is
  'Seals one pre-reserved report and private PDF after exact object/lineage validation, then atomically enqueues the independent review.';

create function public.claim_total_loss_report_review_work_item(
  requested_work_item_id uuid,
  requested_processing_token uuid
)
returns table (
  outcome text,
  case_id uuid,
  package_job_id uuid,
  work_item_id uuid,
  work_item_status text,
  package_status text,
  attempt_count integer,
  processing_token uuid,
  processing_expires_at timestamptz,
  report_version_id uuid,
  final_assessment_id uuid,
  source_snapshot_id uuid,
  report_digest text,
  pdf_digest text,
  ai_review_run_id uuid,
  release_disposition text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  work_row public.workflow_work_items%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  report_row public.total_loss_report_versions%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  order_row public.commerce_orders%rowtype;
  run_row public.total_loss_ai_review_runs%rowtype;
  lease_expires_at timestamptz := statement_timestamp() + interval '30 minutes';
begin
  if requested_work_item_id is null or requested_processing_token is null then
    raise exception using errcode = '22023', message = 'Work item and processing token are required.';
  end if;

  select work_item.* into work_row
  from public.workflow_work_items as work_item
  where work_item.id = requested_work_item_id
  for update;
  if not found then return; end if;
  if work_row.work_type <> 'total_loss_report_review' or work_row.work_version <> '1' then
    raise exception using errcode = '22023', message = 'Work item is not report-review work.';
  end if;

  select package_job.* into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = work_row.package_job_id
    and package_job.case_id = work_row.case_id
  for update;
  select report_version.* into report_row
  from public.total_loss_report_versions as report_version
  where report_version.id = work_row.report_version_id
    and report_version.review_work_item_id = work_row.id
  for update;
  select ai_review.* into run_row
  from public.total_loss_ai_review_runs as ai_review
  where ai_review.work_item_id = work_row.id
    and ai_review.report_version_id = report_row.id
  order by ai_review.attempt_number desc
  limit 1;
  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = work_row.case_id
  for update;
  select entitlement.* into entitlement_row
  from public.case_entitlements as entitlement
  where entitlement.id = package_row.entitlement_id for update;
  select commerce_order.* into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.id = entitlement_row.order_id for update;

  if work_row.status = 'completed' then
    return query select 'completed'::text, work_row.case_id, package_row.id,
      work_row.id, work_row.status, package_row.status, work_row.attempt_count,
      work_row.processing_token, work_row.processing_expires_at,
      report_row.id, report_row.final_assessment_id, report_row.source_snapshot_id,
      report_row.report_digest, report_row.pdf_digest, run_row.id,
      run_row.release_gate_manifest ->> 'disposition';
    return;
  end if;
  if work_row.status = 'terminal_failed' then
    return query select 'terminal_failed'::text, work_row.case_id, package_row.id,
      work_row.id, work_row.status, package_row.status, work_row.attempt_count,
      work_row.processing_token, work_row.processing_expires_at,
      report_row.id, report_row.final_assessment_id, report_row.source_snapshot_id,
      report_row.report_digest, report_row.pdf_digest, run_row.id,
      run_row.release_gate_manifest ->> 'disposition';
    return;
  end if;
  if work_row.status = 'retryable_failed' and work_row.attempt_count >= 3 then
    perform public.fail_total_loss_report_work_item(
      work_row.id,
      work_row.processing_token,
      work_row.last_error_code,
      'retryable',
      1
    );
    select work_item.* into work_row
    from public.workflow_work_items as work_item
    where work_item.id = requested_work_item_id;
    select package_job.* into package_row
    from public.total_loss_package_jobs as package_job
    where package_job.id = work_row.package_job_id;
    select report_version.* into report_row
    from public.total_loss_report_versions as report_version
    where report_version.id = work_row.report_version_id;
    select ai_review.* into run_row
    from public.total_loss_ai_review_runs as ai_review
    where ai_review.work_item_id = work_row.id
    order by ai_review.attempt_number desc
    limit 1;
    return query select 'terminal_failed'::text, work_row.case_id, package_row.id,
      work_row.id, work_row.status, package_row.status, work_row.attempt_count,
      work_row.processing_token, work_row.processing_expires_at,
      report_row.id, report_row.final_assessment_id, report_row.source_snapshot_id,
      report_row.report_digest, report_row.pdf_digest, run_row.id,
      run_row.release_gate_manifest ->> 'disposition';
    return;
  end if;
  if work_row.status = 'retryable_failed'
    and work_row.next_attempt_at > statement_timestamp() then
    return query select 'busy'::text, work_row.case_id, package_row.id,
      work_row.id, work_row.status, package_row.status, work_row.attempt_count,
      work_row.processing_token, work_row.processing_expires_at,
      report_row.id, report_row.final_assessment_id, report_row.source_snapshot_id,
      report_row.report_digest, report_row.pdf_digest, run_row.id,
      run_row.release_gate_manifest ->> 'disposition';
    return;
  end if;
  if work_row.status = 'processing'
    and work_row.processing_expires_at > statement_timestamp()
    and work_row.processing_token is distinct from requested_processing_token then
    return query select 'busy'::text, work_row.case_id, package_row.id,
      work_row.id, work_row.status, package_row.status, work_row.attempt_count,
      work_row.processing_token, work_row.processing_expires_at,
      report_row.id, report_row.final_assessment_id, report_row.source_snapshot_id,
      report_row.report_digest, report_row.pdf_digest, run_row.id,
      run_row.release_gate_manifest ->> 'disposition';
    return;
  end if;

  if report_row.id is null
    or report_row.status not in ('validated', 'reviewing')
    or workflow_row.current_package_job_id is distinct from package_row.id
    or workflow_row.current_report_version_id is distinct from report_row.id
    or not (
      work_row.status in ('queued', 'dispatching', 'retryable_failed', 'processing')
      and package_row.status in ('waiting_ai_review', 'processing', 'retryable_failed')
    )
    or not (
      (entitlement_row.status = 'active' and order_row.status in ('paid', 'partially_refunded'))
      or (entitlement_row.status = 'refunded_access_retained' and order_row.status = 'refunded')
    )
    or not exists (
      select 1 from public.total_loss_claim_documents as document
      where document.id = report_row.document_id
        and document.status = 'ready'
        and document.content_digest = report_row.pdf_digest
    )
  then
    raise exception using errcode = '55000', message = 'Report-review work is not claimable.';
  end if;

  update public.workflow_work_items as work_item
  set status = 'processing',
      attempt_count = case
        when work_item.status = 'processing' and work_item.processing_token = requested_processing_token
          then work_item.attempt_count
        else work_item.attempt_count + 1
      end,
      dispatch_token = null, dispatch_expires_at = null,
      processing_token = requested_processing_token,
      processing_expires_at = lease_expires_at,
      last_error_code = null, retryable = null,
      completed_at = null, failed_at = null
  where work_item.id = work_row.id
  returning * into work_row;

  update public.total_loss_package_jobs as package_job
  set status = 'processing',
      attempt_count = case
        when package_job.status = 'processing'
          and package_job.processing_token = requested_processing_token
          then package_job.attempt_count
        else package_job.attempt_count + 1
      end,
      processing_token = requested_processing_token,
      processing_expires_at = lease_expires_at,
      failure_code = null, retryable = null,
      finished_at = null
  where package_job.id = package_row.id
  returning * into package_row;

  if report_row.status = 'validated' then
    update public.total_loss_report_versions as report_version
    set status = 'reviewing'
    where report_version.id = report_row.id
    returning * into report_row;
  end if;

  update public.total_loss_claim_workflows as workflow
  set current_task = 'report_reviewing', revision = workflow.revision + 1
  where workflow.case_id = workflow_row.case_id
    and workflow.current_task is distinct from 'report_reviewing';

  return query select 'claimed'::text, work_row.case_id, package_row.id,
    work_row.id, work_row.status, package_row.status, work_row.attempt_count,
    work_row.processing_token, work_row.processing_expires_at,
    report_row.id, report_row.final_assessment_id, report_row.source_snapshot_id,
    report_row.report_digest, report_row.pdf_digest, run_row.id,
    run_row.release_gate_manifest ->> 'disposition';
end;
$$;

comment on function public.claim_total_loss_report_review_work_item(uuid, uuid) is
  'Dual-fenced independent-review claim bound to the current immutable report and its sealed PDF.';

create function public.resolve_total_loss_report_review_context(
  requested_work_item_id uuid,
  requested_processing_token uuid
)
returns table (
  case_id uuid,
  package_job_id uuid,
  work_item_id uuid,
  report_series_id uuid,
  report_version_id uuid,
  report_version_number integer,
  source_snapshot_id uuid,
  source_snapshot_digest text,
  source_snapshot jsonb,
  final_assessment_id uuid,
  assessment_digest text,
  final_assessment jsonb,
  report_digest text,
  report jsonb,
  validation_version text,
  validation_manifest jsonb,
  pdf_digest text,
  pdf_byte_size bigint,
  document_id uuid,
  storage_bucket_id text,
  storage_object_name text,
  original_filename text,
  report_status text,
  package_status text,
  workflow_task text,
  current_package_job_id uuid,
  current_report_version_id uuid,
  final_continuation_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    work_item.case_id, work_item.package_job_id, work_item.id,
    report_version.report_series_id, report_version.id,
    report_version.version_number,
    source_snapshot.id, source_snapshot.snapshot_digest,
    source_snapshot.source_snapshot,
    final_assessment.id, final_assessment.assessment_digest,
    final_assessment.assessment,
    report_version.report_digest, report_version.report,
    report_version.validation_version, report_version.validation_manifest,
    report_version.pdf_digest, report_version.pdf_byte_size,
    document.id, document.storage_bucket_id, document.storage_object_name,
    document.original_filename, report_version.status, package_job.status,
    workflow.current_task, workflow.current_package_job_id,
    workflow.current_report_version_id,
    final_assessment.assessment ->> 'continuationStatus'
  from public.workflow_work_items as work_item
  join public.total_loss_package_jobs as package_job
    on package_job.id = work_item.package_job_id
    and package_job.case_id = work_item.case_id
    and package_job.status = 'processing'
    and package_job.processing_token = $2
    and package_job.processing_expires_at > statement_timestamp()
  join public.total_loss_report_versions as report_version
    on report_version.id = work_item.report_version_id
    and report_version.review_work_item_id = work_item.id
    and report_version.status = 'reviewing'
  join public.total_loss_final_assessments as final_assessment
    on final_assessment.id = report_version.final_assessment_id
  join public.total_loss_source_snapshots as source_snapshot
    on source_snapshot.id = report_version.source_snapshot_id
  join public.total_loss_claim_documents as document
    on document.id = report_version.document_id
    and document.status = 'ready'
  join public.total_loss_claim_workflows as workflow
    on workflow.case_id = work_item.case_id
  where work_item.id = $1
    and work_item.work_type = 'total_loss_report_review'
    and work_item.work_version = '1'
    and work_item.status = 'processing'
    and work_item.processing_token = $2
    and work_item.processing_expires_at > statement_timestamp();
$$;

comment on function public.resolve_total_loss_report_review_context(uuid, uuid) is
  'Service-only active-lease review input containing every immutable digest-bound source and private PDF locator.';

create function public.resolve_total_loss_report_release_context(
  requested_work_item_id uuid,
  requested_processing_token uuid,
  requested_ai_review_run_id uuid
)
returns table (
  case_id uuid,
  package_job_id uuid,
  work_item_id uuid,
  report_version_id uuid,
  source_snapshot_id uuid,
  final_assessment_id uuid,
  ai_review_run_id uuid,
  source_snapshot_digest text,
  final_assessment_digest text,
  report_digest text,
  pdf_digest text,
  pdf_validation_digest text,
  input_digest text,
  final_continuation_status text,
  report_status text,
  source_validation_passed boolean,
  report_json_schema_passed boolean,
  deterministic_report_validation_passed boolean,
  pdf_validation_passed boolean,
  package_is_current boolean,
  report_is_current boolean,
  review_is_current boolean,
  human_decision_recorded boolean,
  configured_model_identifier text,
  returned_model_identifier text,
  prompt_version text,
  review_schema_version text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    work_item.case_id, work_item.package_job_id, work_item.id,
    report_version.id, report_version.source_snapshot_id,
    report_version.final_assessment_id, ai_review.id,
    report_version.source_snapshot_digest, report_version.assessment_digest,
    report_version.report_digest, report_version.pdf_digest,
    public.total_loss_canonical_jsonb_digest(report_version.validation_manifest),
    ai_review.input_digest,
    final_assessment.assessment ->> 'continuationStatus',
    report_version.status,
    jsonb_typeof(source_snapshot.source_snapshot -> 'validationManifest') = 'object'
      and not exists (
        select 1
        from jsonb_array_elements(
          coalesce(source_snapshot.source_snapshot #> '{validationManifest,checks}', '[]'::jsonb)
        ) as source_check
        where source_check ->> 'status' = 'REVIEW'
      ),
    jsonb_typeof(report_version.report) = 'object'
      and report_version.report ->> 'schemaVersion' = report_version.schema_version
      and report_version.report ->> 'reportDigest' = report_version.report_digest
      and report_version.report #>> '{identity,reportVersionId}' = report_version.id::text,
    report_version.status = 'reviewing'
      and report_version.validation_manifest ->> 'status' = 'PASS'
      and report_version.validation_manifest ->> 'reportDigest' = report_version.report_digest,
    report_version.validation_manifest ->> 'status' = 'PASS'
      and report_version.validation_manifest ->> 'pdfSha256' = report_version.pdf_digest
      and report_version.validation_manifest ->> 'byteSize' = report_version.pdf_byte_size::text,
    coalesce(workflow.current_package_job_id = work_item.package_job_id, false),
    coalesce(
      workflow.current_report_version_id = report_version.id
        and report_series.current_report_version_id = report_version.id,
      false
    ),
    coalesce(report_version.review_work_item_id = work_item.id, false),
    exists (
      select 1 from public.total_loss_release_reviews as release_review
      where release_review.report_version_id = report_version.id
        and release_review.status = 'resolved'
    ),
    ai_review.model_identifier, ai_review.returned_model_identifier,
    ai_review.prompt_version, ai_review.schema_version
  from public.workflow_work_items as work_item
  join public.total_loss_package_jobs as package_job
    on package_job.id = work_item.package_job_id
    and package_job.processing_token = $2
    and package_job.processing_expires_at > statement_timestamp()
  join public.total_loss_report_versions as report_version
    on report_version.id = work_item.report_version_id
    and report_version.review_work_item_id = work_item.id
  join public.total_loss_report_series as report_series
    on report_series.id = report_version.report_series_id
  join public.total_loss_final_assessments as final_assessment
    on final_assessment.id = report_version.final_assessment_id
  join public.total_loss_source_snapshots as source_snapshot
    on source_snapshot.id = report_version.source_snapshot_id
  join public.total_loss_ai_review_runs as ai_review
    on ai_review.id = $3
    and ai_review.work_item_id = work_item.id
    and ai_review.processing_token = $2
    and ai_review.status = 'processing'
    and ai_review.processing_expires_at > statement_timestamp()
  join public.total_loss_claim_workflows as workflow
    on workflow.case_id = work_item.case_id
  where work_item.id = $1
    and work_item.status = 'processing'
    and work_item.processing_token = $2
    and work_item.processing_expires_at > statement_timestamp();
$$;

comment on function public.resolve_total_loss_report_release_context(uuid, uuid, uuid) is
  'Reloads authoritative current lineage and release inputs after provider completion for the pure deterministic release gate.';

create function public.begin_total_loss_ai_review(
  requested_work_item_id uuid,
  requested_processing_token uuid,
  requested_provider_identifier text,
  requested_configured_model_identifier text,
  requested_prompt_version text,
  requested_schema_version text,
  requested_input_digest text
)
returns table (
  outcome text,
  ai_review_run_id uuid,
  review_status text,
  attempt_number integer,
  processing_expires_at timestamptz,
  returned_model_identifier text,
  recommendation text,
  confidence text,
  review_result jsonb,
  output_digest text,
  usage_metadata jsonb,
  failure_code text,
  release_gate_manifest jsonb,
  release_gate_digest text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  work_row public.workflow_work_items%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  report_row public.total_loss_report_versions%rowtype;
  run_row public.total_loss_ai_review_runs%rowtype;
  next_attempt integer;
  prior_failure_retryable boolean := false;
begin
  if requested_work_item_id is null or requested_processing_token is null
    or requested_provider_identifier !~ '^[a-z][a-z0-9_-]{0,63}$'
    or requested_configured_model_identifier is null
    or char_length(btrim(requested_configured_model_identifier)) not between 1 and 255
    or requested_prompt_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or requested_schema_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or requested_input_digest !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'AI review configuration is invalid.';
  end if;

  select work_item.* into work_row
  from public.workflow_work_items as work_item
  where work_item.id = requested_work_item_id
  for update;
  if not found then return; end if;
  select package_job.* into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = work_row.package_job_id for update;
  select report_version.* into report_row
  from public.total_loss_report_versions as report_version
  where report_version.id = work_row.report_version_id for update;

  if work_row.status <> 'processing'
    or work_row.work_type <> 'total_loss_report_review'
    or work_row.processing_token is distinct from requested_processing_token
    or work_row.processing_expires_at <= statement_timestamp()
    or package_row.status <> 'processing'
    or package_row.processing_token is distinct from requested_processing_token
    or package_row.processing_expires_at <= statement_timestamp()
    or report_row.status <> 'reviewing'
  then
    raise exception using errcode = '55000', message = 'AI review start fence is stale.';
  end if;

  select ai_review.* into run_row
  from public.total_loss_ai_review_runs as ai_review
  where ai_review.work_item_id = work_row.id
    and ai_review.processing_token = requested_processing_token
  order by ai_review.attempt_number desc
  limit 1
  for update;

  if found then
    if run_row.provider_identifier is distinct from requested_provider_identifier
      or run_row.model_identifier is distinct from requested_configured_model_identifier
      or run_row.prompt_version is distinct from requested_prompt_version
      or run_row.schema_version is distinct from requested_schema_version
      or run_row.input_digest is distinct from requested_input_digest then
      raise exception using errcode = '55000', message = 'AI review lease was replayed with different inputs.';
    end if;
    return query select 'existing'::text, run_row.id, run_row.status,
      run_row.attempt_number, run_row.processing_expires_at,
      run_row.returned_model_identifier, run_row.recommendation,
      run_row.confidence, run_row.review_result, run_row.output_digest,
      run_row.usage_metadata, run_row.failure_code,
      run_row.release_gate_manifest, run_row.release_gate_digest;
    return;
  end if;

  select ai_review.* into run_row
  from public.total_loss_ai_review_runs as ai_review
  where ai_review.report_version_id = report_row.id
    and ai_review.input_digest = requested_input_digest
    and ai_review.provider_identifier = requested_provider_identifier
    and ai_review.model_identifier = requested_configured_model_identifier
    and ai_review.prompt_version = requested_prompt_version
    and ai_review.schema_version = requested_schema_version
  order by ai_review.attempt_number desc
  limit 1
  for update;

  if found and run_row.status = 'completed' then
    return query select 'existing'::text, run_row.id, run_row.status,
      run_row.attempt_number, run_row.processing_expires_at,
      run_row.returned_model_identifier, run_row.recommendation,
      run_row.confidence, run_row.review_result, run_row.output_digest,
      run_row.usage_metadata, run_row.failure_code,
      run_row.release_gate_manifest, run_row.release_gate_digest;
    return;
  elsif found and run_row.status = 'processing' then
    update public.total_loss_ai_review_runs as ai_review
    set status = 'failed', processing_expires_at = null,
        failure_code = 'AI_REVIEW_LEASE_ORPHANED',
        completed_at = statement_timestamp()
    where ai_review.id = run_row.id
      and ai_review.status = 'processing'
      and ai_review.processing_token is distinct from requested_processing_token;
    if not found then
      raise exception using errcode = '55000', message = 'AI review processing lease is still active.';
    end if;
    run_row.status := 'failed';
    run_row.failure_code := 'AI_REVIEW_LEASE_ORPHANED';
  elsif found then
    prior_failure_retryable := run_row.status = 'timed_out'
      or run_row.failure_code in (
        'AI_REVIEW_LEASE_ORPHANED',
        'REPORT_REVIEW_TIMEOUT',
        'REPORT_REVIEW_PROVIDER_ERROR',
        'REPORT_REVIEW_FILE_UPLOAD_FAILED',
        'REPORT_REVIEW_FILE_CLEANUP_FAILED',
        'REPORT_REVIEW_SCHEMA_UNAVAILABLE'
      );
    if not prior_failure_retryable or work_row.attempt_count >= 3 then
      perform public.fail_total_loss_report_work_item(
        work_row.id,
        requested_processing_token,
        coalesce(run_row.failure_code, 'REPORT_REVIEW_TERMINAL_FAILURE'),
        'human_review_required',
        0
      );
      return query select 'human_review_required'::text,
        run_row.id, run_row.status, run_row.attempt_number,
        run_row.processing_expires_at, run_row.returned_model_identifier,
        run_row.recommendation, run_row.confidence, run_row.review_result,
        run_row.output_digest, run_row.usage_metadata, run_row.failure_code,
        run_row.release_gate_manifest, run_row.release_gate_digest;
      return;
    end if;
  end if;

  select coalesce(max(ai_review.attempt_number), 0) + 1 into next_attempt
  from public.total_loss_ai_review_runs as ai_review
  where ai_review.report_version_id = report_row.id;

  insert into public.total_loss_ai_review_runs (
    case_id, final_assessment_id, report_version_id, work_item_id,
    source_snapshot_id, attempt_number, provider_identifier,
    model_identifier, prompt_version, schema_version, input_digest,
    assessment_digest, report_digest, pdf_digest,
    processing_token, processing_expires_at, status, started_at
  ) values (
    work_row.case_id, report_row.final_assessment_id, report_row.id, work_row.id,
    report_row.source_snapshot_id, next_attempt, requested_provider_identifier,
    requested_configured_model_identifier, requested_prompt_version,
    requested_schema_version, requested_input_digest, report_row.assessment_digest,
    report_row.report_digest, report_row.pdf_digest,
    requested_processing_token, work_row.processing_expires_at,
    'processing', statement_timestamp()
  ) returning * into run_row;

  return query select 'created'::text, run_row.id, run_row.status,
    run_row.attempt_number, run_row.processing_expires_at,
    run_row.returned_model_identifier, run_row.recommendation,
    run_row.confidence, run_row.review_result, run_row.output_digest,
    run_row.usage_metadata, run_row.failure_code,
    run_row.release_gate_manifest, run_row.release_gate_digest;
end;
$$;

comment on function public.begin_total_loss_ai_review(uuid, uuid, text, text, text, text, text) is
  'Creates one immutable configured-model review attempt for the active review lease; same-token retries reuse it exactly.';

create function public.complete_total_loss_ai_review(
  requested_work_item_id uuid,
  requested_processing_token uuid,
  requested_ai_review_run_id uuid,
  requested_terminal_status text,
  requested_returned_model_identifier text,
  requested_recommendation text,
  requested_confidence text,
  requested_review_result jsonb,
  requested_output_digest text,
  requested_usage_metadata jsonb,
  requested_failure_code text,
  requested_release_gate_manifest jsonb,
  requested_release_gate_digest text
)
returns table (
  outcome text,
  ai_review_run_id uuid,
  review_status text,
  recommendation text,
  confidence text,
  release_gate_digest text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  work_row public.workflow_work_items%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  report_row public.total_loss_report_versions%rowtype;
  series_row public.total_loss_report_series%rowtype;
  run_row public.total_loss_ai_review_runs%rowtype;
  human_decision_recorded boolean := false;
  report_already_published boolean := false;
  stale_or_superseded boolean := false;
  no_action_requested boolean := false;
  no_action_authoritative boolean := false;
  no_action_reason_valid boolean := false;
begin
  if requested_work_item_id is null or requested_processing_token is null
    or requested_ai_review_run_id is null
    or requested_terminal_status not in ('completed', 'failed', 'refused', 'timed_out')
    or (requested_usage_metadata is not null and (
      jsonb_typeof(requested_usage_metadata) <> 'object'
      or pg_column_size(requested_usage_metadata) > 65536
    ))
  then
    raise exception using errcode = '22023', message = 'AI review terminal result is invalid.';
  end if;

  if requested_terminal_status = 'completed' then
    if requested_returned_model_identifier is null
      or char_length(btrim(requested_returned_model_identifier)) not between 1 and 255
      or requested_recommendation not in ('PASS', 'HUMAN_REVIEW')
      or requested_confidence not in ('HIGH', 'MEDIUM', 'LOW')
      or requested_review_result is null
      or jsonb_typeof(requested_review_result) <> 'object'
      or requested_output_digest !~ '^[0-9a-f]{64}$'
      or requested_failure_code is not null
      or requested_release_gate_manifest is null
      or jsonb_typeof(requested_release_gate_manifest) <> 'object'
      or requested_release_gate_digest !~ '^[0-9a-f]{64}$'
    then
      raise exception using errcode = '22023', message = 'Completed AI review is incomplete.';
    end if;
  elsif requested_failure_code is null
    or requested_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    or requested_recommendation is not null or requested_confidence is not null
    or requested_review_result is not null or requested_output_digest is not null
    or requested_release_gate_manifest is not null or requested_release_gate_digest is not null
  then
    raise exception using errcode = '22023', message = 'Failed AI review terminal facts are invalid.';
  end if;

  select work_item.* into work_row
  from public.workflow_work_items as work_item
  where work_item.id = requested_work_item_id for update;
  if not found then return; end if;
  select package_job.* into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = work_row.package_job_id for update;
  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = work_row.case_id for update;
  select report_version.* into report_row
  from public.total_loss_report_versions as report_version
  where report_version.id = work_row.report_version_id for update;
  select report_series.* into series_row
  from public.total_loss_report_series as report_series
  where report_series.id = report_row.report_series_id for update;
  select ai_review.* into run_row
  from public.total_loss_ai_review_runs as ai_review
  where ai_review.id = requested_ai_review_run_id
    and ai_review.work_item_id = work_row.id
    and ai_review.report_version_id = report_row.id
  for update;
  if not found then return; end if;

  if run_row.status in ('completed', 'failed', 'refused', 'timed_out') then
    if run_row.status is distinct from requested_terminal_status
      or run_row.returned_model_identifier is distinct from requested_returned_model_identifier
      or run_row.recommendation is distinct from requested_recommendation
      or run_row.confidence is distinct from requested_confidence
      or run_row.review_result is distinct from requested_review_result
      or run_row.output_digest is distinct from requested_output_digest
      or run_row.failure_code is distinct from requested_failure_code
      or run_row.release_gate_manifest is distinct from requested_release_gate_manifest
      or run_row.release_gate_digest is distinct from requested_release_gate_digest then
      raise exception using errcode = '55000', message = 'Terminal AI review was replayed with different facts.';
    end if;
    return query select 'existing'::text, run_row.id, run_row.status,
      run_row.recommendation, run_row.confidence, run_row.release_gate_digest;
    return;
  end if;

  select exists (
    select 1
    from public.total_loss_release_reviews as release_review
    where release_review.report_version_id = report_row.id
      and release_review.status = 'resolved'
  ) into human_decision_recorded;

  report_already_published := report_row.status = 'published';
  stale_or_superseded := report_row.status = 'superseded'
    or workflow_row.current_package_job_id is distinct from package_row.id
    or workflow_row.current_report_version_id is distinct from report_row.id
    or series_row.current_report_version_id is distinct from report_row.id
    or report_row.review_work_item_id is distinct from work_row.id;
  no_action_requested := requested_terminal_status = 'completed'
    and requested_release_gate_manifest ->> 'disposition' = 'NO_ACTION';
  no_action_authoritative := report_already_published
    or stale_or_superseded
    or human_decision_recorded;
  no_action_reason_valid := jsonb_typeof(
      requested_release_gate_manifest -> 'reasonCodes'
    ) = 'array'
    and (
      (
        report_already_published
        and requested_release_gate_manifest -> 'reasonCodes'
          ? 'REPORT_ALREADY_PUBLISHED'
      )
      or (
        not report_already_published
        and stale_or_superseded
        and requested_release_gate_manifest -> 'reasonCodes'
          ? 'STALE_OR_SUPERSEDED_REVIEW'
      )
      or (
        not report_already_published
        and not stale_or_superseded
        and human_decision_recorded
        and requested_release_gate_manifest -> 'reasonCodes'
          ? 'HUMAN_DECISION_ALREADY_RECORDED'
      )
    );

  if run_row.status <> 'processing'
    or run_row.processing_token is distinct from requested_processing_token
    or run_row.processing_expires_at <= statement_timestamp()
    or work_row.status <> 'processing'
    or work_row.processing_token is distinct from requested_processing_token
    or work_row.processing_expires_at <= statement_timestamp()
    or (
      not no_action_requested
      and (
        package_row.status <> 'processing'
        or package_row.processing_token is distinct from requested_processing_token
        or package_row.processing_expires_at <= statement_timestamp()
        or report_row.status <> 'reviewing'
      )
    )
  then
    raise exception using errcode = '55000', message = 'AI review completion fence is stale.';
  end if;

  if no_action_requested and (
    not no_action_authoritative
    or not no_action_reason_valid
    or requested_release_gate_digest is distinct from
      public.total_loss_canonical_jsonb_digest(requested_release_gate_manifest)
    or requested_release_gate_manifest ->> 'schemaVersion' is distinct from '1'
    or requested_release_gate_manifest ->> 'caseId' is distinct from work_row.case_id::text
    or requested_release_gate_manifest ->> 'packageJobId' is distinct from package_row.id::text
    or requested_release_gate_manifest ->> 'workItemId' is distinct from work_row.id::text
    or requested_release_gate_manifest ->> 'reportVersionId' is distinct from report_row.id::text
    or requested_release_gate_manifest ->> 'sourceSnapshotId' is distinct from run_row.source_snapshot_id::text
    or requested_release_gate_manifest ->> 'finalAssessmentId' is distinct from run_row.final_assessment_id::text
    or requested_release_gate_manifest ->> 'aiReviewRunId' is distinct from run_row.id::text
    or requested_release_gate_manifest ->> 'sourceSnapshotDigest' is distinct from report_row.source_snapshot_digest
    or requested_release_gate_manifest ->> 'finalAssessmentDigest' is distinct from run_row.assessment_digest
    or requested_release_gate_manifest ->> 'reportDigest' is distinct from run_row.report_digest
    or requested_release_gate_manifest ->> 'pdfDigest' is distinct from run_row.pdf_digest
    or requested_release_gate_manifest ->> 'inputDigest' is distinct from run_row.input_digest
    or requested_release_gate_manifest ->> 'outputDigest' is distinct from requested_output_digest
    or requested_release_gate_manifest ->> 'configuredModelIdentifier' is distinct from run_row.model_identifier
    or requested_release_gate_manifest ->> 'returnedModelIdentifier' is distinct from requested_returned_model_identifier
    or requested_release_gate_manifest ->> 'promptVersion' is distinct from run_row.prompt_version
    or requested_release_gate_manifest ->> 'reviewSchemaVersion' is distinct from run_row.schema_version
  ) then
    raise exception using errcode = '55000', message = 'NO_ACTION review state is not authoritative.';
  end if;

  if requested_terminal_status = 'completed' and (
    requested_review_result ->> 'schemaVersion' is distinct from run_row.schema_version
    or requested_review_result #>> '{reviewedTarget,caseId}' is distinct from run_row.case_id::text
    or requested_review_result #>> '{reviewedTarget,sourceSnapshotId}' is distinct from run_row.source_snapshot_id::text
    or requested_review_result #>> '{reviewedTarget,finalAssessmentId}' is distinct from run_row.final_assessment_id::text
    or requested_review_result #>> '{reviewedTarget,reportVersionId}' is distinct from run_row.report_version_id::text
    or requested_review_result #>> '{reviewedDigests,inputDigest}' is distinct from run_row.input_digest
    or requested_review_result #>> '{reviewedDigests,sourceSnapshotDigest}' is distinct from report_row.source_snapshot_digest
    or requested_review_result #>> '{reviewedDigests,finalAssessmentDigest}' is distinct from run_row.assessment_digest
    or requested_review_result #>> '{reviewedDigests,reportDigest}' is distinct from run_row.report_digest
    or requested_review_result #>> '{reviewedDigests,pdfDigest}' is distinct from run_row.pdf_digest
    or requested_review_result ->> 'recommendation' is distinct from requested_recommendation
    or requested_review_result ->> 'confidence' is distinct from requested_confidence
  ) then
    raise exception using errcode = '55000', message = 'AI review result lineage conflicts with its frozen input.';
  end if;

  update public.total_loss_ai_review_runs as ai_review
  set status = requested_terminal_status,
      returned_model_identifier = requested_returned_model_identifier,
      recommendation = requested_recommendation,
      confidence = requested_confidence,
      review_result = requested_review_result,
      output_digest = requested_output_digest,
      usage_metadata = requested_usage_metadata,
      failure_code = requested_failure_code,
      release_gate_manifest = requested_release_gate_manifest,
      release_gate_digest = requested_release_gate_digest,
      processing_expires_at = null,
      completed_at = statement_timestamp()
  where ai_review.id = run_row.id
    and ai_review.status = 'processing'
  returning * into run_row;
  if not found then
    raise exception using errcode = '55000', message = 'AI review completion raced with another terminal result.';
  end if;

  return query select 'completed'::text, run_row.id, run_row.status,
    run_row.recommendation, run_row.confidence, run_row.release_gate_digest;
end;
$$;

comment on function public.complete_total_loss_ai_review(
  uuid, uuid, uuid, text, text, text, text, jsonb, text, jsonb, text, jsonb, text
) is
  'Persists immutable provider terminal facts only; publication remains a separate deterministic database decision.';

create function public.resolve_total_loss_report_release(
  requested_work_item_id uuid,
  requested_processing_token uuid,
  requested_ai_review_run_id uuid
)
returns table (
  outcome text,
  disposition text,
  case_id uuid,
  package_job_id uuid,
  work_item_id uuid,
  report_version_id uuid,
  ai_review_run_id uuid,
  release_review_id uuid,
  report_status text,
  package_status text,
  workflow_task text,
  order_id uuid,
  payment_transaction_id uuid,
  refund_client_request_id uuid,
  refund_request_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  work_row public.workflow_work_items%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  report_row public.total_loss_report_versions%rowtype;
  series_row public.total_loss_report_series%rowtype;
  assessment_row public.total_loss_final_assessments%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  order_row public.commerce_orders%rowtype;
  payment_row public.payment_transactions%rowtype;
  run_row public.total_loss_ai_review_runs%rowtype;
  release_row public.total_loss_release_reviews%rowtype;
  refund_row public.commerce_refund_requests%rowtype;
  gate jsonb;
  continuation_status text;
  requested_disposition text;
  gate_passed boolean := false;
  auto_disposition text;
  mandatory_count integer;
  mandatory_pass_count integer;
  mandatory_distinct_count integer;
  severe_finding_count integer;
  human_decision_recorded boolean := false;
  report_already_published boolean := false;
  stale_or_superseded boolean := false;
  no_action_reason_valid boolean := false;
  no_action_outcome text;
begin
  if requested_work_item_id is null
    or requested_processing_token is null
    or requested_ai_review_run_id is null then
    raise exception using errcode = '22023', message = 'Release identifiers are required.';
  end if;

  select work_item.* into work_row
  from public.workflow_work_items as work_item
  where work_item.id = requested_work_item_id
  for update;
  if not found then return; end if;
  select package_job.* into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = work_row.package_job_id for update;
  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = work_row.case_id for update;
  select report_version.* into report_row
  from public.total_loss_report_versions as report_version
  where report_version.id = work_row.report_version_id for update;
  select report_series.* into series_row
  from public.total_loss_report_series as report_series
  where report_series.id = report_row.report_series_id for update;
  select final_assessment.* into assessment_row
  from public.total_loss_final_assessments as final_assessment
  where final_assessment.id = report_row.final_assessment_id;
  select entitlement.* into entitlement_row
  from public.case_entitlements as entitlement
  where entitlement.id = package_row.entitlement_id for update;
  select commerce_order.* into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.id = entitlement_row.order_id for update;
  select ai_review.* into run_row
  from public.total_loss_ai_review_runs as ai_review
  where ai_review.id = requested_ai_review_run_id
    and ai_review.work_item_id = work_row.id
    and ai_review.report_version_id = report_row.id
  for update;
  if not found then return; end if;

  select release_review.* into release_row
  from public.total_loss_release_reviews as release_review
  where release_review.ai_review_run_id = run_row.id;
  select refund_request.* into refund_row
  from public.commerce_refund_requests as refund_request
  where refund_request.order_id = order_row.id
    and refund_request.client_request_id = report_row.id;

  gate := run_row.release_gate_manifest;
  requested_disposition := gate ->> 'disposition';
  select exists (
    select 1
    from public.total_loss_release_reviews as release_review
    where release_review.report_version_id = report_row.id
      and release_review.status = 'resolved'
  ) into human_decision_recorded;
  report_already_published := report_row.status = 'published';
  stale_or_superseded := report_row.status = 'superseded'
    or workflow_row.current_package_job_id is distinct from package_row.id
    or workflow_row.current_report_version_id is distinct from report_row.id
    or series_row.current_report_version_id is distinct from report_row.id
    or report_row.review_work_item_id is distinct from work_row.id;
  no_action_reason_valid := jsonb_typeof(gate -> 'reasonCodes') = 'array'
    and (
      (
        report_already_published
        and gate -> 'reasonCodes' ? 'REPORT_ALREADY_PUBLISHED'
      )
      or (
        not report_already_published
        and stale_or_superseded
        and gate -> 'reasonCodes' ? 'STALE_OR_SUPERSEDED_REVIEW'
      )
      or (
        not report_already_published
        and not stale_or_superseded
        and human_decision_recorded
        and gate -> 'reasonCodes' ? 'HUMAN_DECISION_ALREADY_RECORDED'
      )
    );

  if requested_disposition = 'NO_ACTION' and run_row.status = 'completed' then
    if gate is null
      or run_row.release_gate_digest is distinct from
        public.total_loss_canonical_jsonb_digest(gate)
      or gate ->> 'schemaVersion' is distinct from '1'
      or gate ->> 'caseId' is distinct from work_row.case_id::text
      or gate ->> 'packageJobId' is distinct from package_row.id::text
      or gate ->> 'workItemId' is distinct from work_row.id::text
      or gate ->> 'reportVersionId' is distinct from report_row.id::text
      or gate ->> 'sourceSnapshotId' is distinct from run_row.source_snapshot_id::text
      or gate ->> 'finalAssessmentId' is distinct from run_row.final_assessment_id::text
      or gate ->> 'aiReviewRunId' is distinct from run_row.id::text
      or gate ->> 'sourceSnapshotDigest' is distinct from report_row.source_snapshot_digest
      or gate ->> 'finalAssessmentDigest' is distinct from run_row.assessment_digest
      or gate ->> 'reportDigest' is distinct from run_row.report_digest
      or gate ->> 'pdfDigest' is distinct from run_row.pdf_digest
      or gate ->> 'inputDigest' is distinct from run_row.input_digest
      or gate ->> 'outputDigest' is distinct from run_row.output_digest
      or gate ->> 'configuredModelIdentifier' is distinct from run_row.model_identifier
      or gate ->> 'returnedModelIdentifier' is distinct from run_row.returned_model_identifier
      or gate ->> 'promptVersion' is distinct from run_row.prompt_version
      or gate ->> 'reviewSchemaVersion' is distinct from run_row.schema_version
      or not (report_already_published or stale_or_superseded or human_decision_recorded)
      or not no_action_reason_valid
    then
      raise exception using errcode = '55000', message = 'NO_ACTION release fence is stale.';
    end if;

    if work_row.status = 'processing' then
      if work_row.processing_token is distinct from requested_processing_token
        or work_row.processing_expires_at is null
        or run_row.completed_at > work_row.processing_expires_at
      then
        raise exception using errcode = '55000', message = 'NO_ACTION release fence is stale.';
      end if;
      update public.workflow_work_items as work_item
      set status = 'completed', processing_expires_at = null,
          completed_at = statement_timestamp(), last_error_code = null,
          retryable = null, failed_at = null
      where work_item.id = work_row.id
        and work_item.status = 'processing'
        and work_item.processing_token = requested_processing_token
        and work_item.processing_expires_at >= run_row.completed_at
      returning * into work_row;
      if not found then
        raise exception using errcode = '55000', message = 'NO_ACTION work completion raced with another transition.';
      end if;
      no_action_outcome := 'completed';
    elsif work_row.status = 'completed'
      and work_row.processing_token = requested_processing_token then
      no_action_outcome := 'existing';
    else
      raise exception using errcode = '55000', message = 'NO_ACTION release fence is stale.';
    end if;

    return query select no_action_outcome, 'NO_ACTION'::text,
      work_row.case_id, package_row.id, work_row.id, report_row.id, run_row.id,
      release_row.id, report_row.status, package_row.status,
      workflow_row.current_task, null::uuid, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  if report_row.status = 'published' then
    if package_row.status in ('refund_pending', 'not_supportable') then
      select payment_transaction.* into payment_row
      from public.payment_transactions as payment_transaction
      where payment_transaction.order_id = order_row.id
        and payment_transaction.case_id = order_row.case_id
        and payment_transaction.transaction_kind = 'payment'
        and payment_transaction.amount_minor_units = order_row.amount_minor_units
        and payment_transaction.currency = order_row.currency
      order by payment_transaction.provider_occurred_at desc
      limit 1;
      auto_disposition := 'AUTO_RELEASE_NO_DISPUTE_REFUND';
    else
      auto_disposition := 'AUTO_RELEASE_SUPPORTABLE';
    end if;
    return query select 'existing'::text, auto_disposition,
      work_row.case_id, package_row.id, work_row.id, report_row.id, run_row.id,
      release_row.id, report_row.status, package_row.status,
      workflow_row.current_task, order_row.id, payment_row.id,
      case when auto_disposition = 'AUTO_RELEASE_NO_DISPUTE_REFUND' then report_row.id else null end,
      refund_row.id;
    return;
  end if;
  if report_row.status = 'human_review_required' then
    return query select 'existing'::text, 'HUMAN_REVIEW'::text,
      work_row.case_id, package_row.id, work_row.id, report_row.id, run_row.id,
      release_row.id, report_row.status, package_row.status,
      workflow_row.current_task, null::uuid, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  if work_row.work_type <> 'total_loss_report_review'
    or work_row.work_version <> '1'
    or work_row.status <> 'processing'
    or work_row.processing_token is distinct from requested_processing_token
    or work_row.processing_expires_at <= statement_timestamp()
    or package_row.status <> 'processing'
    or package_row.processing_token is distinct from requested_processing_token
    or package_row.processing_expires_at <= statement_timestamp()
    or workflow_row.current_package_job_id is distinct from package_row.id
    or workflow_row.current_report_version_id is distinct from report_row.id
    or series_row.current_report_version_id is distinct from report_row.id
    or report_row.review_work_item_id is distinct from work_row.id
    or report_row.status <> 'reviewing'
  then
    raise exception using errcode = '55000', message = 'Report release fence is stale.';
  end if;

  continuation_status := assessment_row.assessment ->> 'continuationStatus';

  if run_row.status = 'completed'
    and run_row.recommendation = 'PASS'
    and run_row.confidence = 'HIGH'
    and run_row.returned_model_identifier = run_row.model_identifier
    and gate is not null
    and gate ->> 'schemaVersion' = '1'
    and gate ->> 'caseId' = work_row.case_id::text
    and gate ->> 'packageJobId' = package_row.id::text
    and gate ->> 'workItemId' = work_row.id::text
    and gate ->> 'reportVersionId' = report_row.id::text
    and gate ->> 'sourceSnapshotId' = report_row.source_snapshot_id::text
    and gate ->> 'finalAssessmentId' = report_row.final_assessment_id::text
    and gate ->> 'aiReviewRunId' = run_row.id::text
    and gate ->> 'sourceSnapshotDigest' = report_row.source_snapshot_digest
    and gate ->> 'finalAssessmentDigest' = report_row.assessment_digest
    and gate ->> 'reportDigest' = report_row.report_digest
    and gate ->> 'pdfDigest' = report_row.pdf_digest
    and gate ->> 'inputDigest' = run_row.input_digest
    and gate ->> 'outputDigest' = run_row.output_digest
    and gate ->> 'deterministicValidationDigest' =
      run_row.review_result #>> '{reviewedDigests,deterministicValidationDigest}'
    and gate ->> 'pdfValidationDigest' =
      run_row.review_result #>> '{reviewedDigests,pdfValidationDigest}'
    and gate ->> 'configuredModelIdentifier' = run_row.model_identifier
    and gate ->> 'returnedModelIdentifier' = run_row.returned_model_identifier
    and gate ->> 'promptVersion' = run_row.prompt_version
    and gate ->> 'reviewSchemaVersion' = run_row.schema_version
    and coalesce((gate ->> 'releaseGateEnabled')::boolean, false)
    and coalesce((gate ->> 'approvalConfigurationComplete')::boolean, false)
    and gate ->> 'approvedModelIdentifier' = run_row.returned_model_identifier
    and gate ->> 'approvedPromptVersion' = run_row.prompt_version
    and gate ->> 'approvedSchemaVersion' = run_row.schema_version
    and coalesce((gate ->> 'providerEvaluationPassed')::boolean, false)
    and gate ->> 'providerEvaluationModelIdentifier' = run_row.returned_model_identifier
    and gate ->> 'providerEvaluationPromptVersion' = run_row.prompt_version
    and gate ->> 'providerEvaluationSchemaVersion' = run_row.schema_version
    and gate ->> 'providerEvaluationSuiteDigest' = gate ->> 'approvedEvalSuiteDigest'
    and coalesce((gate ->> 'sourceValidationPassed')::boolean, false)
    and coalesce((gate ->> 'reportJsonSchemaPassed')::boolean, false)
    and coalesce((gate ->> 'deterministicReportValidationPassed')::boolean, false)
    and coalesce((gate ->> 'pdfValidationPassed')::boolean, false)
    and coalesce((gate ->> 'aiSchemaValidationPassed')::boolean, false)
    and coalesce((gate ->> 'packageIsCurrent')::boolean, false)
    and coalesce((gate ->> 'reportIsCurrent')::boolean, false)
    and coalesce((gate ->> 'reviewIsCurrent')::boolean, false)
    and not coalesce((gate ->> 'humanDecisionRecorded')::boolean, true)
    and run_row.review_result #>> '{sourceReferenceValidation,status}' = 'PASS'
    and jsonb_array_length(coalesce(run_row.review_result #> '{sourceReferenceValidation,unknownIds}', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(run_row.review_result -> 'unsupportedConclusions', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(run_row.review_result -> 'conflicts', '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(run_row.review_result -> 'missingEvidence', '[]'::jsonb)) = 0
    and coalesce((run_row.review_result ->> 'untrustedInstructionFollowed')::boolean, true) = false
    and report_row.validation_manifest ->> 'status' = 'PASS'
    and public.total_loss_canonical_jsonb_digest(report_row.validation_manifest) =
      run_row.review_result #>> '{reviewedDigests,pdfValidationDigest}'
  then
    select count(*),
      count(*) filter (where check_item ->> 'status' = 'PASS'),
      count(distinct check_item ->> 'checkId')
    into mandatory_count, mandatory_pass_count, mandatory_distinct_count
    from jsonb_array_elements(coalesce(run_row.review_result -> 'mandatoryChecks', '[]'::jsonb)) as check_item;

    select count(*) into severe_finding_count
    from jsonb_array_elements(coalesce(run_row.review_result -> 'findings', '[]'::jsonb)) as finding
    where finding ->> 'severity' in ('CRITICAL', 'HIGH');

    gate_passed := mandatory_count = 11
      and mandatory_pass_count = 11
      and mandatory_distinct_count = 11
      and severe_finding_count = 0
      and (
        (continuation_status = 'SUPPORTS_CONTINUATION'
          and requested_disposition = 'AUTO_RELEASE_SUPPORTABLE')
        or (continuation_status = 'DOES_NOT_SUPPORT_CONTINUATION'
          and requested_disposition = 'AUTO_RELEASE_NO_DISPUTE_REFUND')
      );
  end if;

  if not gate_passed then
    insert into public.total_loss_release_reviews (
      case_id, ai_review_run_id, report_version_id, final_assessment_id,
      status, due_at
    ) values (
      work_row.case_id, run_row.id, report_row.id, report_row.final_assessment_id,
      'queued', statement_timestamp() + interval '2 days'
    ) on conflict do nothing;

    select release_review.* into release_row
    from public.total_loss_release_reviews as release_review
    where release_review.ai_review_run_id = run_row.id;

    update public.total_loss_report_versions as report_version
    set status = 'human_review_required'
    where report_version.id = report_row.id
      and report_version.status = 'reviewing'
    returning * into report_row;

    update public.workflow_work_items as work_item
    set status = 'completed', processing_expires_at = null,
        completed_at = statement_timestamp(), last_error_code = null,
        retryable = null, failed_at = null
    where work_item.id = work_row.id
      and work_item.processing_token = requested_processing_token;

    update public.total_loss_package_jobs as package_job
    set status = 'waiting_human_review', processing_expires_at = null,
        failure_code = null, retryable = null, finished_at = null
    where package_job.id = package_row.id
      and package_job.processing_token = requested_processing_token
    returning * into package_row;

    update public.total_loss_claim_workflows as workflow
    set current_task = 'exception_review', revision = workflow.revision + 1
    where workflow.case_id = workflow_row.case_id
      and workflow.revision = workflow_row.revision
    returning * into workflow_row;

    insert into public.total_loss_workflow_events (
      case_id, event_type, actor_type, associated_entity_type,
      associated_entity_id, client_request_id, details
    ) values (
      work_row.case_id, 'report.human_review_required', 'system',
      'total_loss_release_review', release_row.id, run_row.id,
      jsonb_build_object('reportVersionId', report_row.id)
    );

    return query select 'completed'::text, 'HUMAN_REVIEW'::text,
      work_row.case_id, package_row.id, work_row.id, report_row.id, run_row.id,
      release_row.id, report_row.status, package_row.status,
      workflow_row.current_task, null::uuid, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  update public.total_loss_report_versions as report_version
  set status = 'published', published_at = statement_timestamp()
  where report_version.id = report_row.id
    and report_version.status = 'reviewing'
  returning * into report_row;
  if not found then
    raise exception using errcode = '55000', message = 'Report publication raced with another transition.';
  end if;

  update public.total_loss_report_series as report_series
  set current_published_report_version_id = report_row.id
  where report_series.id = series_row.id
    and report_series.current_report_version_id = report_row.id;
  if not found then
    raise exception using errcode = '55000', message = 'Current report changed during publication.';
  end if;

  update public.workflow_work_items as work_item
  set status = 'completed', processing_expires_at = null,
      completed_at = statement_timestamp(), last_error_code = null,
      retryable = null, failed_at = null
  where work_item.id = work_row.id
    and work_item.processing_token = requested_processing_token;
  if not found then
    raise exception using errcode = '55000', message = 'Review work completion fence changed.';
  end if;

  if requested_disposition = 'AUTO_RELEASE_NO_DISPUTE_REFUND' then
    select payment_transaction.* into payment_row
    from public.payment_transactions as payment_transaction
    where payment_transaction.order_id = order_row.id
      and payment_transaction.case_id = order_row.case_id
      and payment_transaction.transaction_kind = 'payment'
      and payment_transaction.amount_minor_units = order_row.amount_minor_units
      and payment_transaction.currency = order_row.currency
    order by payment_transaction.provider_occurred_at desc
    limit 1;
    if payment_row.id is null then
      raise exception using errcode = '55000', message = 'No-dispute refund payment identity is missing.';
    end if;
    update public.total_loss_package_jobs as package_job
    set status = 'refund_pending', processing_expires_at = null,
        failure_code = null, retryable = null, finished_at = null
    where package_job.id = package_row.id
      and package_job.processing_token = requested_processing_token
    returning * into package_row;
    update public.total_loss_claim_workflows as workflow
    set current_task = 'refund_pending', revision = workflow.revision + 1
    where workflow.case_id = workflow_row.case_id
      and workflow.revision = workflow_row.revision
    returning * into workflow_row;
  else
    update public.total_loss_package_jobs as package_job
    set status = 'ready', processing_expires_at = null,
        failure_code = null, retryable = null,
        finished_at = statement_timestamp()
    where package_job.id = package_row.id
      and package_job.processing_token = requested_processing_token
    returning * into package_row;
    update public.total_loss_claim_workflows as workflow
    set current_task = 'report_ready', revision = workflow.revision + 1
    where workflow.case_id = workflow_row.case_id
      and workflow.revision = workflow_row.revision
    returning * into workflow_row;
  end if;

  insert into public.total_loss_workflow_events (
    case_id, event_type, actor_type, associated_entity_type,
    associated_entity_id, client_request_id, details
  ) values (
    work_row.case_id, 'report.published', 'system',
    'total_loss_report_version', report_row.id, run_row.id,
    jsonb_build_object('disposition', requested_disposition)
  );

  return query select 'completed'::text, requested_disposition,
    work_row.case_id, package_row.id, work_row.id, report_row.id, run_row.id,
    null::uuid, report_row.status, package_row.status, workflow_row.current_task,
    case when requested_disposition = 'AUTO_RELEASE_NO_DISPUTE_REFUND' then order_row.id else null end,
    case when requested_disposition = 'AUTO_RELEASE_NO_DISPUTE_REFUND' then payment_row.id else null end,
    case when requested_disposition = 'AUTO_RELEASE_NO_DISPUTE_REFUND' then report_row.id else null end,
    null::uuid;
end;
$$;

comment on function public.resolve_total_loss_report_release(uuid, uuid, uuid) is
  'Independently rechecks every current lineage, digest, model, evaluation, deterministic validation, and semantic review gate before atomic publication or fail-closed staff hold.';

create function public.get_total_loss_release_review(
  requested_release_review_id uuid
)
returns table (
  release_review_id uuid,
  case_id uuid,
  review_status text,
  assigned_staff_user_id uuid,
  decision text,
  rationale text,
  due_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz,
  ai_review_run_id uuid,
  report_version_id uuid,
  resulting_report_version_id uuid,
  report_status text,
  report jsonb,
  report_digest text,
  validation_manifest jsonb,
  pdf_digest text,
  storage_bucket_id text,
  storage_object_name text,
  source_snapshot_id uuid,
  source_snapshot_digest text,
  final_assessment_id uuid,
  assessment_digest text,
  final_assessment jsonb,
  review_result jsonb,
  release_gate_manifest jsonb,
  failure_stage text,
  failure_code text,
  artifact_availability jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if requested_release_review_id is null
    or (select auth.uid()) is null
    or not public.is_venfour_staff()
    or exists (
      select 1 from auth.users as auth_user
      where auth_user.id = (select auth.uid())
        and coalesce(auth_user.is_anonymous, false)
    )
  then
    return;
  end if;

  return query
  select
    release_review.id, release_review.case_id, release_review.status,
    release_review.assigned_staff_user_id, release_review.decision,
    release_review.rationale, release_review.due_at,
    release_review.resolved_at, release_review.updated_at,
    ai_review.id, report_version.id,
    release_review.resulting_report_version_id, report_version.status,
    report_version.report, report_version.report_digest,
    report_version.validation_manifest, report_version.pdf_digest,
    document.storage_bucket_id, document.storage_object_name,
    source_snapshot.id, source_snapshot.snapshot_digest,
    final_assessment.id, final_assessment.assessment_digest,
    final_assessment.assessment, ai_review.review_result,
    ai_review.release_gate_manifest,
    case
      when report_version.report is null then 'report_generation'
      when ai_review.status in ('failed', 'refused', 'timed_out') then 'ai_review'
      when review_work.last_error_code is not null then 'report_review'
      when ai_review.id is not null then 'release_gate'
      else null
    end,
    coalesce(
      review_work.last_error_code,
      generation_work.last_error_code,
      ai_review.failure_code,
      report_version.failure_code
    ),
    jsonb_build_object(
      'report', report_version.report is not null,
      'validationManifest', report_version.validation_manifest is not null,
      'pdf', report_version.pdf_digest is not null,
      'aiReview', ai_review.id is not null,
      'reviewResult', ai_review.review_result is not null,
      'releaseGateManifest', ai_review.release_gate_manifest is not null
    )
  from public.total_loss_release_reviews as release_review
  join public.total_loss_report_versions as report_version
    on report_version.id = release_review.report_version_id
  left join public.total_loss_ai_review_runs as ai_review
    on ai_review.id = release_review.ai_review_run_id
  left join public.workflow_work_items as generation_work
    on generation_work.id = report_version.generation_work_item_id
  left join public.workflow_work_items as review_work
    on review_work.id = report_version.review_work_item_id
  join public.total_loss_claim_documents as document
    on document.id = report_version.document_id
  join public.total_loss_source_snapshots as source_snapshot
    on source_snapshot.id = report_version.source_snapshot_id
  join public.total_loss_final_assessments as final_assessment
    on final_assessment.id = report_version.final_assessment_id
  where release_review.id = requested_release_review_id;
end;
$$;

comment on function public.get_total_loss_release_review(uuid) is
  'Staff-only complete immutable release-review packet including the private deliverable locator.';

create function public.decide_total_loss_release_review(
  requested_release_review_id uuid,
  requested_expected_updated_at timestamptz,
  requested_decision text,
  requested_rationale text
)
returns table (
  outcome text,
  release_review_id uuid,
  case_id uuid,
  decision text,
  report_version_id uuid,
  resulting_report_version_id uuid,
  report_status text,
  package_status text,
  workflow_task text,
  generation_work_item_id uuid,
  order_id uuid,
  payment_transaction_id uuid,
  refund_client_request_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  staff_user_id uuid := (select auth.uid());
  release_row public.total_loss_release_reviews%rowtype;
  report_row public.total_loss_report_versions%rowtype;
  series_row public.total_loss_report_series%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  assessment_row public.total_loss_final_assessments%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  order_row public.commerce_orders%rowtype;
  payment_row public.payment_transactions%rowtype;
  new_work_row public.workflow_work_items%rowtype;
  new_report_row public.total_loss_report_versions%rowtype;
  new_document_row public.total_loss_claim_documents%rowtype;
  next_sequence integer;
  next_report_version_number integer;
  next_report_version_identifier uuid;
  no_dispute boolean;
  generation_failure_review boolean := false;
begin
  if requested_release_review_id is null
    or requested_expected_updated_at is null
    or requested_decision not in (
      'approved', 'revision_requested', 'not_supportable', 'new_evidence_required'
    )
    or requested_rationale is null
    or char_length(btrim(requested_rationale)) not between 1 and 10000
    or staff_user_id is null
    or not public.is_venfour_staff()
    or exists (
      select 1 from auth.users as auth_user
      where auth_user.id = staff_user_id
        and coalesce(auth_user.is_anonymous, false)
    )
  then
    raise exception using errcode = '42501', message = 'Staff release decision is not authorized or invalid.';
  end if;

  select release_review.* into release_row
  from public.total_loss_release_reviews as release_review
  where release_review.id = requested_release_review_id
  for update;
  if not found then return; end if;

  select report_version.* into report_row
  from public.total_loss_report_versions as report_version
  where report_version.id = release_row.report_version_id for update;
  select report_series.* into series_row
  from public.total_loss_report_series as report_series
  where report_series.id = report_row.report_series_id for update;
  select package_job.* into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = report_row.package_job_id for update;
  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = report_row.case_id for update;
  select final_assessment.* into assessment_row
  from public.total_loss_final_assessments as final_assessment
  where final_assessment.id = report_row.final_assessment_id;
  select entitlement.* into entitlement_row
  from public.case_entitlements as entitlement
  where entitlement.id = package_row.entitlement_id for update;
  select commerce_order.* into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.id = entitlement_row.order_id for update;

  generation_failure_review := report_row.status = 'failed'
    and report_row.report is null
    and release_row.ai_review_run_id is null;

  if release_row.status = 'resolved' then
    if release_row.decision is distinct from requested_decision
      or release_row.rationale is distinct from btrim(requested_rationale) then
      raise exception using errcode = '55000', message = 'Release review was already resolved differently.';
    end if;
    if release_row.resulting_report_version_id is not null then
      select report_version.* into new_report_row
      from public.total_loss_report_versions as report_version
      where report_version.id = release_row.resulting_report_version_id
        and report_version.case_id = release_row.case_id
        and report_version.report_series_id = report_row.report_series_id;
      select work_item.* into new_work_row
      from public.workflow_work_items as work_item
      where work_item.id = new_report_row.generation_work_item_id
        and work_item.report_version_id = new_report_row.id
        and work_item.work_type = 'total_loss_report_generate';
      if new_report_row.id is null or new_work_row.id is null then
        raise exception using
          errcode = '55000',
          message = 'Resolved release review replacement lineage is incomplete.';
      end if;
    end if;
    return query select 'existing'::text, release_row.id, release_row.case_id,
      release_row.decision, report_row.id, release_row.resulting_report_version_id,
      report_row.status, package_row.status, workflow_row.current_task,
      new_work_row.id, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  if release_row.status not in ('queued', 'in_review')
    or release_row.updated_at is distinct from requested_expected_updated_at
    or not (
      report_row.status = 'human_review_required'
      or generation_failure_review
    )
    or package_row.status <> 'waiting_human_review'
    or workflow_row.current_package_job_id is distinct from package_row.id
    or workflow_row.current_report_version_id is distinct from report_row.id
    or series_row.current_report_version_id is distinct from report_row.id
  then
    raise exception using errcode = '40001', message = 'Release review or current report changed before the decision.';
  end if;

  if generation_failure_review
    and requested_decision not in ('revision_requested', 'new_evidence_required')
  then
    raise exception using errcode = '22023', message = 'A failed generation can only be regenerated or held for new evidence.';
  end if;

  no_dispute := requested_decision = 'not_supportable'
    or (
      requested_decision = 'approved'
      and assessment_row.assessment ->> 'continuationStatus' = 'DOES_NOT_SUPPORT_CONTINUATION'
    );

  if requested_decision in ('approved', 'not_supportable') then
    update public.total_loss_report_versions as report_version
    set status = 'published', published_at = statement_timestamp()
    where report_version.id = report_row.id
    returning * into report_row;
    update public.total_loss_report_series as report_series
    set current_published_report_version_id = report_row.id
    where report_series.id = series_row.id;

    if no_dispute then
      select payment_transaction.* into payment_row
      from public.payment_transactions as payment_transaction
      where payment_transaction.order_id = order_row.id
        and payment_transaction.case_id = order_row.case_id
        and payment_transaction.transaction_kind = 'payment'
        and payment_transaction.amount_minor_units = order_row.amount_minor_units
        and payment_transaction.currency = order_row.currency
      order by payment_transaction.provider_occurred_at desc
      limit 1;
      if payment_row.id is null then
        raise exception using errcode = '55000', message = 'No-dispute refund payment identity is missing.';
      end if;
      update public.total_loss_package_jobs as package_job
      set status = 'refund_pending', processing_expires_at = null,
          failure_code = null, retryable = null, finished_at = null
      where package_job.id = package_row.id
      returning * into package_row;
      update public.total_loss_claim_workflows as workflow
      set current_task = 'refund_pending', revision = workflow.revision + 1
      where workflow.case_id = workflow_row.case_id
      returning * into workflow_row;
    else
      update public.total_loss_package_jobs as package_job
      set status = 'ready', processing_expires_at = null,
          failure_code = null, retryable = null,
          finished_at = statement_timestamp()
      where package_job.id = package_row.id
      returning * into package_row;
      update public.total_loss_claim_workflows as workflow
      set current_task = 'report_ready', revision = workflow.revision + 1
      where workflow.case_id = workflow_row.case_id
      returning * into workflow_row;
    end if;
  elsif requested_decision = 'revision_requested' then
    if not generation_failure_review then
      update public.total_loss_report_versions as report_version
      set status = 'superseded'
      where report_version.id = report_row.id
      returning * into report_row;
    end if;

    update public.total_loss_package_jobs as package_job
    set status = 'assessment_ready', processing_expires_at = null,
        failure_code = null, retryable = null,
        finished_at = statement_timestamp()
    where package_job.id = package_row.id
    returning * into package_row;

    select coalesce(max(work_item.sequence_number), 0) + 1 into next_sequence
    from public.workflow_work_items as work_item
    where work_item.package_job_id = package_row.id
      and work_item.work_type = 'total_loss_report_generate';
    insert into public.workflow_work_items (
      case_id, package_job_id, work_type, work_version,
      sequence_number, status, next_attempt_at
    ) values (
      package_row.case_id, package_row.id, 'total_loss_report_generate', '1',
      next_sequence, 'queued', statement_timestamp()
    ) returning * into new_work_row;

    select coalesce(max(report_version.version_number), 0) + 1
      into next_report_version_number
    from public.total_loss_report_versions as report_version
    where report_version.report_series_id = series_row.id;
    next_report_version_identifier := gen_random_uuid();

    insert into public.total_loss_claim_documents (
      case_id, document_kind, storage_bucket_id, storage_object_name,
      original_filename, media_type, status
    ) values (
      report_row.case_id, 'valuation_evidence_report', 'case-deliverables',
      'cases/' || report_row.case_id::text || '/reports/' || series_row.id::text ||
        '/versions/' || next_report_version_identifier::text ||
        '/valuation-evidence-package.pdf',
      'valuation-evidence-package.pdf', 'application/pdf', 'pending'
    ) returning * into new_document_row;

    insert into public.total_loss_report_versions (
      id, case_id, report_series_id, version_number, final_assessment_id,
      preliminary_snapshot_id, document_id, package_job_id, source_snapshot_id,
      generation_work_item_id, source_snapshot_digest, assessment_digest,
      status, supersedes_report_version_id
    ) values (
      next_report_version_identifier, report_row.case_id,
      report_row.report_series_id, next_report_version_number,
      report_row.final_assessment_id, report_row.preliminary_snapshot_id,
      new_document_row.id, report_row.package_job_id,
      report_row.source_snapshot_id, new_work_row.id,
      report_row.source_snapshot_digest, report_row.assessment_digest,
      'draft', report_row.id
    ) returning * into new_report_row;

    update public.workflow_work_items as work_item
    set report_version_id = new_report_row.id
    where work_item.id = new_work_row.id
    returning * into new_work_row;

    update public.total_loss_report_series as report_series
    set current_report_version_id = new_report_row.id
    where report_series.id = series_row.id
    returning * into series_row;

    update public.total_loss_claim_workflows as workflow
    set current_report_version_id = new_report_row.id,
        current_task = 'report_generation_queued',
        revision = workflow.revision + 1
    where workflow.case_id = workflow_row.case_id
    returning * into workflow_row;
  else
    if not generation_failure_review then
      update public.total_loss_report_versions as report_version
      set status = 'superseded'
      where report_version.id = report_row.id
      returning * into report_row;
    end if;
    update public.total_loss_package_jobs as package_job
    set status = 'new_evidence_required', processing_expires_at = null,
        failure_code = 'NEW_EVIDENCE_REQUIRED', retryable = false,
        finished_at = statement_timestamp()
    where package_job.id = package_row.id
    returning * into package_row;
    update public.total_loss_claim_workflows as workflow
    set current_task = 'exception_review', revision = workflow.revision + 1
    where workflow.case_id = workflow_row.case_id
    returning * into workflow_row;
  end if;

  update public.total_loss_release_reviews as release_review
  set status = 'resolved', decision = requested_decision,
      rationale = btrim(requested_rationale),
      resulting_report_version_id = case
        when requested_decision = 'revision_requested' then new_report_row.id
        else null
      end,
      resolved_by_user_id = staff_user_id,
      resolved_at = statement_timestamp(),
      assigned_staff_user_id = coalesce(release_review.assigned_staff_user_id, staff_user_id)
  where release_review.id = release_row.id
    and release_review.updated_at = requested_expected_updated_at
  returning * into release_row;
  if not found then
    raise exception using errcode = '40001', message = 'Release review changed before resolution.';
  end if;

  insert into public.total_loss_workflow_events (
    case_id, event_type, actor_type, actor_user_id,
    associated_entity_type, associated_entity_id, client_request_id, details
  ) values (
    release_row.case_id, 'report.release_review_resolved', 'staff', staff_user_id,
    'total_loss_release_review', release_row.id, release_row.id,
    jsonb_build_object(
      'decision', requested_decision,
      'resultingReportVersionId', release_row.resulting_report_version_id
    )
  );

  return query select 'completed'::text, release_row.id, release_row.case_id,
    release_row.decision, report_row.id, release_row.resulting_report_version_id,
    report_row.status, package_row.status, workflow_row.current_task,
    new_work_row.id,
    case when no_dispute then order_row.id else null end,
    case when no_dispute then payment_row.id else null end,
    case when no_dispute then report_row.id else null end;
end;
$$;

comment on function public.decide_total_loss_release_review(uuid, timestamptz, text, text) is
  'Staff-only optimistic-concurrency decision that atomically publishes, requests a new report version, or holds for new evidence.';

create function public.complete_total_loss_no_dispute_refund(
  requested_report_version_id uuid,
  requested_refund_request_id uuid
)
returns table (
  outcome text,
  case_id uuid,
  report_version_id uuid,
  refund_request_id uuid,
  package_status text,
  workflow_phase text,
  workflow_task text,
  entitlement_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  report_row public.total_loss_report_versions%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  order_row public.commerce_orders%rowtype;
  refund_row public.commerce_refund_requests%rowtype;
begin
  if requested_report_version_id is null or requested_refund_request_id is null then
    raise exception using errcode = '22023', message = 'Report and refund identifiers are required.';
  end if;

  select report_version.* into report_row
  from public.total_loss_report_versions as report_version
  where report_version.id = requested_report_version_id for update;
  if not found then return; end if;
  select package_job.* into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = report_row.package_job_id for update;
  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = report_row.case_id for update;
  select entitlement.* into entitlement_row
  from public.case_entitlements as entitlement
  where entitlement.id = package_row.entitlement_id for update;
  select commerce_order.* into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.id = entitlement_row.order_id for update;
  select refund_request.* into refund_row
  from public.commerce_refund_requests as refund_request
  where refund_request.id = requested_refund_request_id
    and refund_request.case_id = report_row.case_id
    and refund_request.order_id = order_row.id
  for update;

  if package_row.status = 'not_supportable'
    and workflow_row.current_task = 'no_dispute_resolved' then
    if refund_row.status <> 'succeeded' then
      raise exception using errcode = '55000', message = 'Completed no-dispute refund no longer has a succeeded refund.';
    end if;
    return query select 'existing'::text, report_row.case_id, report_row.id,
      refund_row.id, package_row.status, workflow_row.phase::text,
      workflow_row.current_task, entitlement_row.status::text;
    return;
  end if;

  if report_row.status <> 'published'
    or package_row.status <> 'refund_pending'
    or workflow_row.current_package_job_id is distinct from package_row.id
    or workflow_row.current_report_version_id is distinct from report_row.id
    or refund_row.id is null
    or refund_row.client_request_id is distinct from report_row.id
    or refund_row.status <> 'succeeded'
    or refund_row.access_policy <> 'retain'
    or refund_row.reason_code <> 'NO_MATERIAL_DISPUTE_SUPPORTED'
    or order_row.status <> 'refunded'
    or entitlement_row.status <> 'refunded_access_retained'
  then
    raise exception using errcode = '55000', message = 'Succeeded retained-access no-dispute refund projection is inconsistent.';
  end if;

  update public.total_loss_package_jobs as package_job
  set status = 'not_supportable', processing_expires_at = null,
      failure_code = null, retryable = null,
      finished_at = statement_timestamp()
  where package_job.id = package_row.id
  returning * into package_row;

  update public.total_loss_claim_workflows as workflow
  set phase = 'resolution', current_task = 'no_dispute_resolved',
      resolution_code = 'NO_DISPUTE_SUPPORTED',
      resolved_at = statement_timestamp(), revision = workflow.revision + 1
  where workflow.case_id = workflow_row.case_id
    and workflow.revision = workflow_row.revision
  returning * into workflow_row;
  if not found then
    raise exception using errcode = '40001', message = 'Claim workflow changed during no-dispute completion.';
  end if;

  insert into public.total_loss_workflow_events (
    case_id, event_type, actor_type, associated_entity_type,
    associated_entity_id, client_request_id, details
  ) values (
    report_row.case_id, 'report.no_dispute_refund_completed', 'system',
    'commerce_refund_request', refund_row.id, refund_row.id,
    jsonb_build_object('accessPolicy', 'retain')
  ) on conflict do nothing;

  return query select 'completed'::text, report_row.case_id, report_row.id,
    refund_row.id, package_row.status, workflow_row.phase::text,
    workflow_row.current_task, entitlement_row.status::text;
end;
$$;

comment on function public.complete_total_loss_no_dispute_refund(uuid, uuid) is
  'Converges publication plus a succeeded full retained-access refund to the immutable no-dispute package resolution after either crash ordering.';

create function public.resolve_total_loss_no_dispute_refund_recovery(
  requested_report_version_id uuid
)
returns table (
  outcome text,
  case_id uuid,
  report_version_id uuid,
  package_job_id uuid,
  package_status text,
  order_id uuid,
  payment_transaction_id uuid,
  refund_client_request_id uuid,
  refund_request_id uuid,
  refund_status text,
  access_policy text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  report_row public.total_loss_report_versions%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  series_row public.total_loss_report_series%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  order_row public.commerce_orders%rowtype;
  payment_row public.payment_transactions%rowtype;
  refund_row public.commerce_refund_requests%rowtype;
begin
  if requested_report_version_id is null then
    raise exception using errcode = '22023', message = 'Report identifier is required.';
  end if;

  select report_version.* into report_row
  from public.total_loss_report_versions as report_version
  where report_version.id = requested_report_version_id;
  if not found then return; end if;
  select package_job.* into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = report_row.package_job_id;
  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = report_row.case_id;
  select report_series.* into series_row
  from public.total_loss_report_series as report_series
  where report_series.id = report_row.report_series_id;
  select entitlement.* into entitlement_row
  from public.case_entitlements as entitlement
  where entitlement.id = package_row.entitlement_id;
  select commerce_order.* into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.id = entitlement_row.order_id;
  select payment_transaction.* into payment_row
  from public.payment_transactions as payment_transaction
  where payment_transaction.order_id = order_row.id
    and payment_transaction.case_id = order_row.case_id
    and payment_transaction.transaction_kind = 'payment'
    and payment_transaction.amount_minor_units = order_row.amount_minor_units
    and payment_transaction.currency = order_row.currency
  order by payment_transaction.provider_occurred_at desc
  limit 1;
  select refund_request.* into refund_row
  from public.commerce_refund_requests as refund_request
  where refund_request.order_id = order_row.id
    and refund_request.client_request_id = report_row.id;

  if report_row.status <> 'published'
    or package_row.status not in (
      'refund_pending', 'waiting_human_review', 'not_supportable'
    )
    or workflow_row.current_package_job_id is distinct from package_row.id
    or workflow_row.current_report_version_id is distinct from report_row.id
    or series_row.current_report_version_id is distinct from report_row.id
    or series_row.current_published_report_version_id is distinct from report_row.id
    or payment_row.id is null
    or (
      refund_row.id is not null
      and (
        refund_row.case_id is distinct from report_row.case_id
        or refund_row.payment_transaction_id is distinct from payment_row.id
        or refund_row.reason_code <> 'NO_MATERIAL_DISPUTE_SUPPORTED'
        or refund_row.access_policy <> 'retain'
      )
    )
  then
    raise exception using errcode = '55000', message = 'No-dispute refund recovery context is not current or is inconsistent.';
  end if;

  return query select
    case
      when package_row.status = 'not_supportable' then 'completed'
      when package_row.status = 'waiting_human_review'
        then 'human_review_required'
      when refund_row.id is null then 'refund_required'
      when refund_row.status = 'succeeded' then 'completion_required'
      when refund_row.status in ('failed', 'canceled')
        then 'human_review_required'
      else 'refund_in_progress'
    end,
    report_row.case_id, report_row.id, package_row.id, package_row.status,
    order_row.id, payment_row.id, report_row.id, refund_row.id,
    refund_row.status, refund_row.access_policy;
end;
$$;

comment on function public.resolve_total_loss_no_dispute_refund_recovery(uuid) is
  'Crash-safe service projection for resuming the stable retained-access refund or entering durable human remediation after a terminal provider failure.';

create function public.hold_total_loss_no_dispute_refund_failure(
  requested_report_version_id uuid,
  requested_refund_request_id uuid default null
)
returns table (
  outcome text,
  case_id uuid,
  report_version_id uuid,
  refund_request_id uuid,
  refund_status text,
  package_status text,
  workflow_task text,
  entitlement_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  report_row public.total_loss_report_versions%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  series_row public.total_loss_report_series%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  order_row public.commerce_orders%rowtype;
  refund_row public.commerce_refund_requests%rowtype;
begin
  if requested_report_version_id is null then
    raise exception using errcode = '22023', message = 'Report identifier is required.';
  end if;

  select report_version.* into report_row
  from public.total_loss_report_versions as report_version
  where report_version.id = requested_report_version_id
  for update;
  if not found then return; end if;
  select package_job.* into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = report_row.package_job_id
  for update;
  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = report_row.case_id
  for update;
  select report_series.* into series_row
  from public.total_loss_report_series as report_series
  where report_series.id = report_row.report_series_id
  for update;
  select entitlement.* into entitlement_row
  from public.case_entitlements as entitlement
  where entitlement.id = package_row.entitlement_id
  for update;
  select commerce_order.* into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.id = entitlement_row.order_id
  for update;
  select refund_request.* into refund_row
  from public.commerce_refund_requests as refund_request
  where refund_request.order_id = order_row.id
    and refund_request.client_request_id = report_row.id
    and (
      requested_refund_request_id is null
      or refund_request.id = requested_refund_request_id
    )
  for update;

  if refund_row.id is null
    or refund_row.status not in ('creating', 'pending', 'failed', 'canceled')
    or refund_row.reason_code <> 'NO_MATERIAL_DISPUTE_SUPPORTED'
    or refund_row.access_policy <> 'retain'
    or report_row.status <> 'published'
    or workflow_row.current_package_job_id is distinct from package_row.id
    or workflow_row.current_report_version_id is distinct from report_row.id
    or series_row.current_report_version_id is distinct from report_row.id
    or series_row.current_published_report_version_id is distinct from report_row.id
    or package_row.status not in ('refund_pending', 'waiting_human_review')
    or entitlement_row.status not in ('active', 'refunded_access_retained')
  then
    raise exception using errcode = '55000', message = 'Terminal refund remediation context is stale or inconsistent.';
  end if;

  if package_row.status = 'waiting_human_review' then
    return query select 'existing'::text, report_row.case_id, report_row.id,
      refund_row.id, refund_row.status, package_row.status,
      workflow_row.current_task, entitlement_row.status::text;
    return;
  end if;

  update public.total_loss_package_jobs as package_job
  set status = 'waiting_human_review', processing_expires_at = null,
      failure_code = null, retryable = null, finished_at = null
  where package_job.id = package_row.id
    and package_job.status = 'refund_pending'
  returning * into package_row;
  if not found then
    raise exception using errcode = '55000', message = 'Terminal refund remediation raced with another transition.';
  end if;

  update public.total_loss_claim_workflows as workflow
  set current_task = 'exception_review', revision = workflow.revision + 1
  where workflow.case_id = workflow_row.case_id
    and workflow.revision = workflow_row.revision
  returning * into workflow_row;
  if not found then
    raise exception using errcode = '40001', message = 'Claim workflow changed during refund remediation.';
  end if;

  insert into public.total_loss_workflow_events (
    case_id, event_type, actor_type, associated_entity_type,
    associated_entity_id, client_request_id, details
  ) values (
    report_row.case_id, 'report.no_dispute_refund_human_review', 'system',
    'commerce_refund_request', refund_row.id, refund_row.id,
    jsonb_build_object(
      'refundStatus', refund_row.status,
      'accessPolicy', refund_row.access_policy
    )
  ) on conflict do nothing;

  return query select 'completed'::text, report_row.case_id, report_row.id,
    refund_row.id, refund_row.status, package_row.status,
    workflow_row.current_task, entitlement_row.status::text;
end;
$$;

comment on function public.hold_total_loss_no_dispute_refund_failure(uuid, uuid) is
  'Idempotently preserves the published report and access while moving a failed, canceled, or service-detected non-transient no-dispute refund problem into bounded human remediation.';

create function public.fail_total_loss_report_work_item(
  requested_work_item_id uuid,
  requested_processing_token uuid,
  requested_failure_code text,
  requested_failure_kind text,
  requested_retry_delay_seconds integer
)
returns table (
  outcome text,
  work_item_id uuid,
  work_item_status text,
  package_job_id uuid,
  package_status text,
  report_version_id uuid,
  report_status text,
  release_review_id uuid,
  workflow_task text,
  next_attempt_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  work_row public.workflow_work_items%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  report_row public.total_loss_report_versions%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  run_row public.total_loss_ai_review_runs%rowtype;
  release_row public.total_loss_release_reviews%rowtype;
  report_failure_kind text;
  effective_failure_kind text;
  retry_exhausted boolean := false;
begin
  if requested_work_item_id is null or requested_processing_token is null
    or requested_failure_code is null
    or requested_failure_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
    or requested_failure_kind not in ('retryable', 'human_review_required', 'terminal')
    or requested_retry_delay_seconds is null
    or (
      requested_failure_kind = 'retryable'
      and requested_retry_delay_seconds not between 1 and 86400
    )
    or (
      requested_failure_kind <> 'retryable'
      and requested_retry_delay_seconds <> 0
    )
  then
    raise exception using errcode = '22023', message = 'Report work failure is invalid.';
  end if;

  select work_item.* into work_row
  from public.workflow_work_items as work_item
  where work_item.id = requested_work_item_id
  for update;
  if not found then return; end if;
  if work_row.work_type not in ('total_loss_report_generate', 'total_loss_report_review')
    or work_row.work_version <> '1' then
    raise exception using errcode = '22023', message = 'Work item is not report work.';
  end if;

  select package_job.* into package_row
  from public.total_loss_package_jobs as package_job
  where package_job.id = work_row.package_job_id for update;
  select report_version.* into report_row
  from public.total_loss_report_versions as report_version
  where report_version.id = work_row.report_version_id for update;
  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = work_row.case_id for update;

  retry_exhausted := requested_failure_kind = 'retryable'
    and work_row.attempt_count >= 3;
  effective_failure_kind := case
    when retry_exhausted and report_row.id is not null
      then 'human_review_required'
    when retry_exhausted then 'terminal'
    else requested_failure_kind
  end;

  if work_row.status in ('retryable_failed', 'terminal_failed') then
    if work_row.status = 'retryable_failed' and retry_exhausted then
      null;
    elsif work_row.processing_token is distinct from requested_processing_token
      or work_row.last_error_code is distinct from requested_failure_code
      or (
        effective_failure_kind = 'retryable'
        and work_row.status <> 'retryable_failed'
      )
      or (
        effective_failure_kind <> 'retryable'
        and work_row.status <> 'terminal_failed'
      ) then
      raise exception using errcode = '55000', message = 'Report failure was already recorded differently.';
    else
      select release_review.* into release_row
      from public.total_loss_release_reviews as release_review
      where release_review.report_version_id = report_row.id
        and release_review.status in ('queued', 'in_review');
      return query select 'existing'::text, work_row.id, work_row.status,
        package_row.id, package_row.status, report_row.id, report_row.status,
        release_row.id, workflow_row.current_task, work_row.next_attempt_at;
      return;
    end if;
  end if;

  if not (
      work_row.status = 'processing'
      and work_row.processing_token = requested_processing_token
      and work_row.processing_expires_at > statement_timestamp()
      and package_row.processing_token = requested_processing_token
      and package_row.processing_expires_at > statement_timestamp()
      and workflow_row.current_package_job_id = package_row.id
    )
    and not (
      retry_exhausted
      and work_row.status = 'retryable_failed'
      and work_row.processing_token = requested_processing_token
      and package_row.status = 'retryable_failed'
      and package_row.processing_token = requested_processing_token
      and workflow_row.current_package_job_id = package_row.id
    )
  then
    raise exception using errcode = '55000', message = 'Report failure fence is stale.';
  end if;

  if effective_failure_kind = 'retryable' then
    update public.workflow_work_items as work_item
    set status = 'retryable_failed', processing_expires_at = null,
        last_error_code = requested_failure_code, retryable = true,
        failed_at = statement_timestamp(), completed_at = null,
        next_attempt_at = statement_timestamp()
          + pg_catalog.make_interval(secs => requested_retry_delay_seconds)
    where work_item.id = work_row.id
      and work_item.processing_token = requested_processing_token
    returning * into work_row;
    update public.total_loss_package_jobs as package_job
    set status = 'retryable_failed', processing_expires_at = null,
        failure_code = requested_failure_code, retryable = true,
        finished_at = statement_timestamp()
    where package_job.id = package_row.id
      and package_job.processing_token = requested_processing_token
    returning * into package_row;
    update public.total_loss_claim_workflows as workflow
    set current_task = 'finalizing', revision = workflow.revision + 1
    where workflow.case_id = workflow_row.case_id
    returning * into workflow_row;
  elsif effective_failure_kind = 'human_review_required'
    and report_row.id is not null then
    select ai_review.* into run_row
    from public.total_loss_ai_review_runs as ai_review
    where ai_review.work_item_id = work_row.id
    order by ai_review.attempt_number desc
    limit 1;

    insert into public.total_loss_release_reviews (
      case_id, ai_review_run_id, report_version_id, final_assessment_id,
      status, due_at
    ) values (
      work_row.case_id, run_row.id, report_row.id, report_row.final_assessment_id,
      'queued', statement_timestamp() + interval '2 days'
    ) on conflict do nothing;
    select release_review.* into release_row
    from public.total_loss_release_reviews as release_review
    where release_review.report_version_id = report_row.id
      and release_review.status in ('queued', 'in_review');

    if report_row.report is not null then
      update public.total_loss_report_versions as report_version
      set status = 'human_review_required'
      where report_version.id = report_row.id
        and report_version.status not in ('published', 'superseded', 'failed')
      returning * into report_row;
    elsif report_row.status = 'draft' then
      update public.total_loss_report_versions as report_version
      set status = 'failed',
          failure_code = case
            when work_row.work_type = 'total_loss_report_generate'
              then 'REPORT_GENERATION_VALIDATION_FAILED'
            else requested_failure_code
          end
      where report_version.id = report_row.id
      returning * into report_row;
    end if;
    update public.workflow_work_items as work_item
    set status = 'terminal_failed', processing_expires_at = null,
        last_error_code = requested_failure_code, retryable = false,
        failed_at = statement_timestamp(), completed_at = null
    where work_item.id = work_row.id
    returning * into work_row;
    update public.total_loss_package_jobs as package_job
    set status = 'waiting_human_review', processing_expires_at = null,
        failure_code = null, retryable = null, finished_at = null
    where package_job.id = package_row.id
    returning * into package_row;
    update public.total_loss_claim_workflows as workflow
    set current_task = 'exception_review', revision = workflow.revision + 1
    where workflow.case_id = workflow_row.case_id
    returning * into workflow_row;
  else
    report_failure_kind := case
      when effective_failure_kind = 'human_review_required'
        then 'REPORT_GENERATION_VALIDATION_FAILED'
      else requested_failure_code
    end;
    if report_row.id is not null and report_row.status not in ('published', 'superseded', 'failed') then
      update public.total_loss_report_versions as report_version
      set status = 'failed', failure_code = report_failure_kind
      where report_version.id = report_row.id
      returning * into report_row;
    end if;
    update public.workflow_work_items as work_item
    set status = 'terminal_failed', processing_expires_at = null,
        last_error_code = requested_failure_code, retryable = false,
        failed_at = statement_timestamp(), completed_at = null
    where work_item.id = work_row.id
    returning * into work_row;
    update public.total_loss_package_jobs as package_job
    set status = 'failed', processing_expires_at = null,
        failure_code = requested_failure_code, retryable = false,
        finished_at = statement_timestamp()
    where package_job.id = package_row.id
    returning * into package_row;
    update public.total_loss_claim_workflows as workflow
    set current_task = 'exception_review', revision = workflow.revision + 1
    where workflow.case_id = workflow_row.case_id
    returning * into workflow_row;
  end if;

  insert into public.total_loss_workflow_events (
    case_id, event_type, actor_type, associated_entity_type,
    associated_entity_id, client_request_id, details
  ) values (
    work_row.case_id, 'report.work_failed', 'system',
    'workflow_work_item', work_row.id, work_row.id,
    jsonb_build_object(
      'failureCode', requested_failure_code,
      'failureKind', effective_failure_kind,
      'retryExhausted', retry_exhausted
    )
  ) on conflict do nothing;

  return query select 'completed'::text, work_row.id, work_row.status,
    package_row.id, package_row.status, report_row.id, report_row.status,
    release_row.id, workflow_row.current_task, work_row.next_attempt_at;
end;
$$;

comment on function public.fail_total_loss_report_work_item(uuid, uuid, text, text, integer) is
  'Three-attempt dual-fenced failure transition for generation and review, preserving stable rows while separating delayed retry, staff hold, and terminal failure.';

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
  safe_task text;
begin
  if authenticated_user_id is null or requested_case_id is null then return; end if;
  select auth_user.* into authenticated_user
  from auth.users as auth_user where auth_user.id = authenticated_user_id;
  if not found then return; end if;

  select contact.* into contact_row
  from public.appraisal_cases as appraisal_case
  join public.total_loss_case_contacts as contact on contact.case_id = appraisal_case.id
  where appraisal_case.id = requested_case_id
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss';
  if not found
    or not public.total_loss_post_continue_case_is_eligible_internal(requested_case_id)
  then return; end if;

  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = requested_case_id;
  select commerce_order.* into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.case_id = requested_case_id
  order by commerce_order.created_at desc, commerce_order.id desc limit 1;
  if order_row.id is not null then
    select entitlement.* into entitlement_row
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
    and lower(btrim(authenticated_user.email)) = contact_row.email then
    result_row.state := 'secured';
  else
    result_row.state := 'account_mismatch';
  end if;

  safe_task := case
    when workflow_row.current_task in (
      'report_generation_queued', 'report_generating', 'report_review_queued',
      'report_reviewing', 'refund_pending', 'report_revision_required'
    ) then 'finalizing'
    when workflow_row.current_task in ('exception_review', 'report_failed')
      then 'exception_review'
    when workflow_row.current_task = 'report_ready' then 'report_ready'
    when workflow_row.current_task = 'no_dispute_resolved' then 'no_dispute_supported'
    else workflow_row.current_task
  end;

  result_row.case_id := requested_case_id;
  result_row.contact_email := contact_row.email;
  result_row.workflow_phase := workflow_row.phase::text;
  result_row.workflow_current_task := safe_task;
  result_row.workflow_revision := workflow_row.revision;
  result_row.checkout_available := (
    result_row.state = 'secured'
    and workflow_row.phase = 'review'
    and workflow_row.current_task = 'secure_claim'
    and entitlement_row.id is null
    and (
      order_row.id is null
      or (order_row.status = 'pending' and order_row.purchaser_email is not null)
    )
    and not exists (
      select 1 from public.checkout_attempts as completed_attempt
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
        and workflow_row.current_package_job_id is not null then safe_task
      when entitlement_row.id is not null then 'purchase_complete'
      when result_row.checkout_available then 'checkout'
      when order_row.status = 'void' then 'purchase_unavailable'
      else safe_task
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
  'Owner-safe resume projection mapping internal report orchestration to finalizing, exception review, report ready, or no-dispute-supported states.';

-- All mutation/orchestration functions are service-only. Staff reads and
-- decisions execute only with an authenticated staff JWT.
revoke execute on function public.total_loss_canonical_jsonb_text(jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.total_loss_canonical_jsonb_digest(jsonb)
  from public, anon, authenticated;
grant execute on function public.total_loss_canonical_jsonb_digest(jsonb)
  to service_role;
revoke execute on function public.enqueue_total_loss_report_generation(uuid)
  from public, anon, authenticated;
grant execute on function public.enqueue_total_loss_report_generation(uuid)
  to service_role;
revoke execute on function public.resolve_workflow_work_item_kind(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_workflow_work_item_kind(uuid)
  to service_role;
revoke execute on function public.claim_total_loss_report_generation_work_item(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_total_loss_report_generation_work_item(uuid, uuid)
  to service_role;
revoke execute on function public.resolve_total_loss_report_generation_context(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_total_loss_report_generation_context(uuid, uuid)
  to service_role;
revoke execute on function public.complete_total_loss_report_generation(
  uuid, uuid, jsonb, text, text, text, text, text, jsonb, bigint, text
) from public, anon, authenticated;
grant execute on function public.complete_total_loss_report_generation(
  uuid, uuid, jsonb, text, text, text, text, text, jsonb, bigint, text
) to service_role;
revoke execute on function public.claim_total_loss_report_review_work_item(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_total_loss_report_review_work_item(uuid, uuid)
  to service_role;
revoke execute on function public.resolve_total_loss_report_review_context(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_total_loss_report_review_context(uuid, uuid)
  to service_role;
revoke execute on function public.resolve_total_loss_report_release_context(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_total_loss_report_release_context(uuid, uuid, uuid)
  to service_role;
revoke execute on function public.begin_total_loss_ai_review(
  uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.begin_total_loss_ai_review(
  uuid, uuid, text, text, text, text, text
) to service_role;
revoke execute on function public.complete_total_loss_ai_review(
  uuid, uuid, uuid, text, text, text, text, jsonb, text, jsonb, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.complete_total_loss_ai_review(
  uuid, uuid, uuid, text, text, text, text, jsonb, text, jsonb, text, jsonb, text
) to service_role;
revoke execute on function public.resolve_total_loss_report_release(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_total_loss_report_release(uuid, uuid, uuid)
  to service_role;
revoke execute on function public.complete_total_loss_no_dispute_refund(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_total_loss_no_dispute_refund(uuid, uuid)
  to service_role;
revoke execute on function public.resolve_total_loss_no_dispute_refund_recovery(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_total_loss_no_dispute_refund_recovery(uuid)
  to service_role;
revoke execute on function public.hold_total_loss_no_dispute_refund_failure(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.hold_total_loss_no_dispute_refund_failure(uuid, uuid)
  to service_role;
revoke execute on function public.fail_total_loss_report_work_item(uuid, uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.fail_total_loss_report_work_item(uuid, uuid, text, text, integer)
  to service_role;

revoke execute on function public.get_total_loss_release_review(uuid)
  from public, anon, service_role;
grant execute on function public.get_total_loss_release_review(uuid)
  to authenticated;
revoke execute on function public.decide_total_loss_release_review(uuid, timestamptz, text, text)
  from public, anon, service_role;
grant execute on function public.decide_total_loss_release_review(uuid, timestamptz, text, text)
  to authenticated;

revoke execute on function public.protect_total_loss_report_version_m5()
  from public, anon, authenticated, service_role;
revoke execute on function public.protect_total_loss_sealed_deliverable_object()
  from public, anon, authenticated, service_role;
