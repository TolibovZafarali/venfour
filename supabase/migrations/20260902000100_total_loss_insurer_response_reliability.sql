-- Expiring leases recover abandoned uploads without deleting request identity,
-- storage objects or submitted documents. Existing submission and sealing
-- contracts remain unchanged, including finalization after an upload expires.

alter table public.total_loss_claim_documents
  add column insurer_response_upload_expires_at timestamptz;

comment on column public.total_loss_claim_documents.insurer_response_upload_expires_at is
  'Write authorization lease for pending insurer-response uploads; expiration never deletes material or permits client request identity reuse.';

-- Preserve the original preparation window for pre-existing incomplete uploads.
-- Ready documents and any already-linked material are deliberately untouched.
update public.total_loss_claim_documents as document
set insurer_response_upload_expires_at = document.created_at + interval '30 minutes'
where document.document_kind = 'insurer_response'
  and document.status = 'pending'
  and not exists (
    select 1 from public.total_loss_communication_documents as linked_document
    where linked_document.document_id = document.id
      and linked_document.case_id = document.case_id
  );

create index total_loss_insurer_response_active_uploads_idx
  on public.total_loss_claim_documents (
    case_id, created_by_user_id, insurer_response_upload_expires_at
  )
  where document_kind = 'insurer_response' and status = 'pending';

create or replace function public.authorize_total_loss_insurer_response_document_mutation(
  requested_object_name text,
  requested_user_metadata jsonb,
  requested_object_metadata jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.total_loss_claim_documents as document
    join public.total_loss_case_details as details
      on details.case_id = document.case_id
    join public.appraisal_cases as appraisal_case
      on appraisal_case.id = document.case_id
    where document.storage_bucket_id = 'case-files'
      and document.storage_object_name = $1
      and document.document_kind = 'insurer_response'
      and document.status = 'pending'
      and document.insurer_response_upload_expires_at > statement_timestamp()
      and document.created_by_user_id = (select auth.uid())
      and appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'total_loss'
      and public.is_permanent_total_loss_case_owner(document.case_id)
      and cardinality(storage.foldername($1)) = 3
      and (storage.foldername($1))[1] = details.report_storage_owner_id::text
      and (storage.foldername($1))[2] = document.case_id::text
      and (storage.foldername($1))[3] = 'insurer-responses'
      and storage.filename($1) = document.id::text || '.' ||
        public.total_loss_insurer_response_canonical_extension(document.media_type)
      and $2 = jsonb_build_object(
        'clientRequestId', document.id::text,
        'originalName', document.original_filename,
        'contentDigest', document.content_digest
      )
      and jsonb_typeof($3) = 'object'
      and $3 ->> 'mimetype' = document.media_type
      and $3 ->> 'size' ~ '^[0-9]+$'
      and ($3 ->> 'size')::bigint = document.byte_size
      and document.media_type is not null
      and document.byte_size between 1 and 10485760
      and document.content_digest ~ '^[0-9a-f]{64}$'
  );
$$;

comment on function public.authorize_total_loss_insurer_response_document_mutation(text, jsonb, jsonb) is
  'Authorizes only an exact owner-created pending insurer-response object with an unexpired lease; ready documents cannot be replaced or deleted.';

revoke execute on function public.authorize_total_loss_insurer_response_document_mutation(text, jsonb, jsonb)
  from public, anon, service_role;
grant execute on function public.authorize_total_loss_insurer_response_document_mutation(text, jsonb, jsonb)
  to authenticated;

create or replace function public.prepare_total_loss_insurer_response_upload(
  requested_case_id uuid,
  requested_client_request_id uuid,
  requested_original_filename text,
  requested_media_type text,
  requested_byte_size bigint,
  requested_content_digest text,
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
  details_row public.total_loss_case_details%rowtype;
  document_row public.total_loss_claim_documents%rowtype;
  normalized_filename text;
  normalized_media_type text;
  canonical_extension text;
  expected_object_name text;
  pending_permit_count bigint;
begin
  if authenticated_user_id is null
    or requested_case_id is null
    or requested_client_request_id is null
    or requested_original_filename is null
    or requested_media_type is null
    or requested_byte_size is null
    or requested_content_digest is null
    or expected_workflow_revision is null
  then
    raise exception using
      errcode = '22023',
      message = 'Complete insurer-response upload metadata is required.';
  end if;

  normalized_filename := requested_original_filename;
  normalized_media_type := pg_catalog.lower(pg_catalog.btrim(requested_media_type));
  canonical_extension := public.total_loss_insurer_response_canonical_extension(
    normalized_media_type
  );

  if pg_catalog.char_length(normalized_filename) not between 1 and 255
    or normalized_filename <> pg_catalog.btrim(normalized_filename)
    or normalized_filename <> pg_catalog.regexp_replace(
      normalized_filename,
      '[[:space:]]+',
      ' ',
      'g'
    )
    or position('/' in normalized_filename) <> 0
    or position(pg_catalog.chr(92) in normalized_filename) <> 0
    or normalized_filename ~ '[[:cntrl:]]'
    or normalized_filename ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    or canonical_extension is null
    or (
      normalized_media_type = 'image/jpeg'
      and normalized_filename !~* '\.jpe?g$'
    )
    or (
      normalized_media_type <> 'image/jpeg'
      and normalized_filename !~* ('\.' || canonical_extension || '$')
    )
    or requested_byte_size not between 1 and 10485760
    or requested_content_digest !~ '^[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Insurer-response upload metadata is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_insurer_response'),
    pg_catalog.hashtext(requested_case_id::text)
  );

  if not public.is_permanent_total_loss_case_owner(requested_case_id) then
    raise exception using
      errcode = '42501',
      message = 'Insurer-response upload is unavailable.';
  end if;

  select details.* into details_row
  from public.total_loss_case_details as details
  where details.case_id = requested_case_id;
  if not found or details_row.report_storage_owner_id is null then
    raise exception using
      errcode = '42501',
      message = 'Insurer-response upload is unavailable.';
  end if;

  expected_object_name := details_row.report_storage_owner_id::text || '/' ||
    requested_case_id::text || '/insurer-responses/' ||
    requested_client_request_id::text || '.' || canonical_extension;

  select document.* into document_row
  from public.total_loss_claim_documents as document
  where document.id = requested_client_request_id;
  if found then
    if document_row.case_id is distinct from requested_case_id
      or document_row.document_kind <> 'insurer_response'
      or document_row.storage_bucket_id <> 'case-files'
      or document_row.storage_object_name <> expected_object_name
      or document_row.original_filename <> normalized_filename
      or document_row.media_type <> normalized_media_type
      or document_row.byte_size <> requested_byte_size
      or document_row.content_digest <> requested_content_digest
      or document_row.created_by_user_id is distinct from authenticated_user_id
      or document_row.status not in ('pending', 'ready')
    then
      raise exception using
        errcode = '55000',
        message = 'Client request identity was already used.';
    end if;

    -- A sealed retry is read-only. Pending retries renew below only after the
    -- current owner, workflow and report-access gates have been rechecked.
    if document_row.status = 'ready' then
      return jsonb_build_object(
        'documentId', document_row.id,
        'uploadPath', document_row.storage_object_name,
        'originalFilename', document_row.original_filename,
        'mediaType', document_row.media_type,
        'byteSize', document_row.byte_size,
        'contentDigest', document_row.content_digest
      );
    end if;
  end if;

  if exists (
    select 1
    from public.total_loss_workflow_events as event
    where event.case_id = requested_case_id
      and event.client_request_id = requested_client_request_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'Client request identity was already used.';
  end if;

  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = requested_case_id
  for update;
  if not found
    or (
      document_row.id is null
      and workflow_row.revision is distinct from expected_workflow_revision
    )
    or workflow_row.current_task not in (
      'awaiting_insurer_response',
      'insurer_response_received'
    )
  then
    raise exception using
      errcode = '40001',
      message = 'Claim workflow changed before insurer-response upload preparation.';
  end if;

  if workflow_row.current_report_version_id is null
    or not public.total_loss_customer_report_access_internal(
      requested_case_id,
      workflow_row.current_report_version_id
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Insurer-response upload is unavailable.';
  end if;

  -- The same case lock serializes capacity checks, renewal and submission.
  -- Expired rows retain exact request identity but no longer authorize writes.
  -- Excluding only this request lets active retries renew without allowing an
  -- expired request to open a sixth writable path.
  select pg_catalog.count(*) into pending_permit_count
  from public.total_loss_claim_documents as document
  where document.case_id = requested_case_id
    and document.document_kind = 'insurer_response'
    and document.status = 'pending'
    and document.created_by_user_id = authenticated_user_id
    and document.id <> requested_client_request_id
    and document.insurer_response_upload_expires_at > statement_timestamp();
  if pending_permit_count >= 5 then
    raise exception using
      errcode = '55000',
      message = 'Too many insurer-response uploads are incomplete.';
  end if;

  if document_row.id is not null then
    update public.total_loss_claim_documents as document
    set insurer_response_upload_expires_at = statement_timestamp() + interval '30 minutes'
    where document.id = document_row.id
      and document.status = 'pending'
    returning * into document_row;
  else
    insert into public.total_loss_claim_documents (
      id,
      case_id,
      document_kind,
      storage_bucket_id,
      storage_object_name,
      original_filename,
      media_type,
      byte_size,
      content_digest,
      status,
      created_by_user_id,
      insurer_response_upload_expires_at
    ) values (
      requested_client_request_id,
      requested_case_id,
      'insurer_response',
      'case-files',
      expected_object_name,
      normalized_filename,
      normalized_media_type,
      requested_byte_size,
      requested_content_digest,
      'pending',
      authenticated_user_id,
      statement_timestamp() + interval '30 minutes'
    )
    returning * into document_row;
  end if;

  return jsonb_build_object(
    'documentId', document_row.id,
    'uploadPath', document_row.storage_object_name,
    'originalFilename', document_row.original_filename,
    'mediaType', document_row.media_type,
    'byteSize', document_row.byte_size,
    'contentDigest', document_row.content_digest
  );
end;
$$;

comment on function public.prepare_total_loss_insurer_response_upload(uuid, uuid, text, text, bigint, text, bigint) is
  'Creates or renews an exact owner-scoped insurer-response upload lease; expired identities remain immutable replay tombstones without consuming active capacity.';

revoke execute on function public.prepare_total_loss_insurer_response_upload(uuid, uuid, text, text, bigint, text, bigint)
  from public, anon, service_role;
grant execute on function public.prepare_total_loss_insurer_response_upload(uuid, uuid, text, text, bigint, text, bigint)
  to authenticated;

create or replace function public.resolve_total_loss_case_claim(requested_case_id uuid)
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

  -- Decorate only the normal response branch chosen by the authoritative
  -- resolver. Access, commerce and attention states must pass through intact.
  if result_row.state is distinct from 'secured'
    or result_row.workflow_current_task is distinct from 'insurer_response_received'
    or result_row.next_task is distinct from 'insurer_response_received'
    or result_row.customer_journey ->> 'nextState'
      is distinct from 'insurer_response_received'
    or result_row.customer_journey ->> 'fulfillmentState'
      is distinct from 'insurer_response_received'
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
  'Adds response-analysis resume states only after the authoritative resolver selects an unblocked insurer-response journey.';

revoke execute on function public.resolve_total_loss_case_claim(uuid)
  from public, anon, service_role;
grant execute on function public.resolve_total_loss_case_claim(uuid)
  to authenticated;
