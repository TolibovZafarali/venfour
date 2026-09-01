-- Add the first customer-owned insurer-response intake slice. Response content
-- remains append-only, Storage writes are fenced to an exact pending document,
-- and the durable workflow task remains the authority for unprocessed work.

create unique index total_loss_communications_one_initial_insurer_response_idx
  on public.total_loss_communications (case_id, negotiation_round_id)
  where direction = 'inbound'
    and communication_type = 'insurer_response'
    and supersedes_communication_id is null;

create unique index total_loss_communications_one_insurer_response_successor_idx
  on public.total_loss_communications (case_id, supersedes_communication_id)
  where direction = 'inbound'
    and communication_type = 'insurer_response'
    and supersedes_communication_id is not null;

create function public.total_loss_insurer_response_canonical_extension(
  requested_media_type text
)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case $1
    when 'application/pdf' then 'pdf'
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/heic' then 'heic'
    when 'image/heif' then 'heif'
    else null
  end;
$$;

comment on function public.total_loss_insurer_response_canonical_extension(text) is
  'Internal allowlist mapping for customer insurer-response attachment MIME types.';

revoke execute on function public.total_loss_insurer_response_canonical_extension(text)
  from public, anon, authenticated, service_role;

create function public.authorize_total_loss_insurer_response_document_mutation(
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
  'Authorizes only an exact owner-created pending insurer-response object; ready documents cannot be replaced or deleted.';

revoke execute on function public.authorize_total_loss_insurer_response_document_mutation(text, jsonb, jsonb)
  from public, anon, service_role;
grant execute on function public.authorize_total_loss_insurer_response_document_mutation(text, jsonb, jsonb)
  to authenticated;

drop policy if exists "Customers can add files for their own cases"
on storage.objects;

create policy "Customers can add files for their own cases"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'case-files'
  and (
    (
      public.authorize_total_loss_storage_namespace(name)
      and cardinality(storage.foldername(name)) = 2
      and storage.filename(name) in (
        'valuation-report.pdf',
        'valuation-report-backup.pdf'
      )
      and public.authorize_total_loss_report_storage_write(name, user_metadata)
    )
    or public.authorize_total_loss_insurer_response_document_mutation(
      name,
      user_metadata,
      metadata
    )
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and public.authorize_diminished_value_document_mutation(name)
      and jsonb_typeof(user_metadata) = 'object'
      and char_length(user_metadata ->> 'originalName') between 1 and 255
      and user_metadata ->> 'originalName' = regexp_replace(
        btrim(user_metadata ->> 'originalName'),
        '[[:space:]]+',
        ' ',
        'g'
      )
      and user_metadata ->> 'originalName' ~* '\.(pdf|jpe?g|png|heic|heif)$'
      and (
        (
          storage.filename(name) ~ '\.pdf$'
          and user_metadata ->> 'originalName' ~* '\.pdf$'
        )
        or (
          storage.filename(name) ~ '\.jpg$'
          and user_metadata ->> 'originalName' ~* '\.jpe?g$'
        )
        or (
          storage.filename(name) ~ '\.png$'
          and user_metadata ->> 'originalName' ~* '\.png$'
        )
        or (
          storage.filename(name) ~ '\.heic$'
          and user_metadata ->> 'originalName' ~* '\.heic$'
        )
        or (
          storage.filename(name) ~ '\.heif$'
          and user_metadata ->> 'originalName' ~* '\.heif$'
        )
      )
      and position('/' in user_metadata ->> 'originalName') = 0
      and position(chr(92) in user_metadata ->> 'originalName') = 0
      and user_metadata ->> 'originalName' !~ '[[:cntrl:]]'
      and user_metadata ->> 'originalName' !~
        U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    )
  )
);

comment on policy "Customers can add files for their own cases"
on storage.objects is
  'Total-Loss inserts include exact pending insurer-response permits while retaining report-token and Diminished Value rules.';

drop policy if exists "Customers can delete files for their own cases"
on storage.objects;

create policy "Customers can delete files for their own cases"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'case-files'
  and (
    (
      public.authorize_total_loss_storage_namespace(name)
      and cardinality(storage.foldername(name)) = 2
      and storage.filename(name) = 'valuation-report-backup.pdf'
      and public.authorize_total_loss_report_backup_delete(
        name,
        user_metadata
      )
    )
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and public.authorize_diminished_value_document_mutation(name)
    )
  )
);

comment on policy "Customers can delete files for their own cases"
on storage.objects is
  'Customer deletion retains report-backup and Diminished Value rules; insurer-response objects are not directly deletable through Storage.';

create function public.prepare_total_loss_insurer_response_upload(
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

    return jsonb_build_object(
      'documentId', document_row.id,
      'uploadPath', document_row.storage_object_name,
      'originalFilename', document_row.original_filename,
      'mediaType', document_row.media_type,
      'byteSize', document_row.byte_size,
      'contentDigest', document_row.content_digest
    );
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
    or workflow_row.revision is distinct from expected_workflow_revision
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

  -- Same-request retries return above. Bound distinct abandoned permits so an
  -- authenticated case owner cannot reserve unbounded private object paths.
  select pg_catalog.count(*) into pending_permit_count
  from public.total_loss_claim_documents as document
  where document.case_id = requested_case_id
    and document.document_kind = 'insurer_response'
    and document.status = 'pending'
    and document.created_by_user_id = authenticated_user_id;
  if pending_permit_count >= 5 then
    raise exception using
      errcode = '55000',
      message = 'Too many insurer-response uploads are incomplete.';
  end if;

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
    created_by_user_id
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
    authenticated_user_id
  )
  returning * into document_row;

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
  'Creates or replays one exact pending owner-scoped insurer-response upload permit without advancing workflow state.';

revoke execute on function public.prepare_total_loss_insurer_response_upload(uuid, uuid, text, text, bigint, text, bigint)
  from public, anon, service_role;
grant execute on function public.prepare_total_loss_insurer_response_upload(uuid, uuid, text, text, bigint, text, bigint)
  to authenticated;

create function public.total_loss_insurer_response_projection_internal(
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
  projected_offer_id uuid;
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

  return jsonb_build_object(
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
    'processingState', 'not_started',
    'supersedesResponseId', communication_row.supersedes_communication_id
  );
end;
$$;

comment on function public.total_loss_insurer_response_projection_internal(uuid, uuid) is
  'Internal owner-facing projection for one immutable insurer response; storage paths and content digests are intentionally omitted.';

revoke execute on function public.total_loss_insurer_response_projection_internal(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.total_loss_current_insurer_response_projection_internal(
  requested_case_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.total_loss_insurer_response_projection_internal(
    $1,
    communication.id
  )
  from public.total_loss_communications as communication
  where communication.case_id = $1
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
$$;

comment on function public.total_loss_current_insurer_response_projection_internal(uuid) is
  'Internal projection of the unsuperseded confirmed insurer response for one case.';

revoke execute on function public.total_loss_current_insurer_response_projection_internal(uuid)
  from public, anon, authenticated, service_role;

create function public.record_total_loss_insurer_response(
  requested_case_id uuid,
  requested_client_request_id uuid,
  requested_response_text text,
  requested_revised_offer_minor_units bigint,
  requested_document_id uuid,
  requested_retained_document_id uuid,
  requested_supersedes_response_id uuid,
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
  round_row public.total_loss_negotiation_rounds%rowtype;
  report_row public.total_loss_report_versions%rowtype;
  communication_row public.total_loss_communications%rowtype;
  superseded_response_row public.total_loss_communications%rowtype;
  document_row public.total_loss_claim_documents%rowtype;
  object_row storage.objects%rowtype;
  offer_row public.total_loss_offers%rowtype;
  previous_offer_row public.total_loss_offers%rowtype;
  event_row public.total_loss_workflow_events%rowtype;
  normalized_response_text text;
  request_digest text;
  report_currency text;
  effective_document_id uuid;
  effective_offer_id uuid;
  recorded_at timestamptz := statement_timestamp();
begin
  if authenticated_user_id is null
    or requested_case_id is null
    or requested_client_request_id is null
    or expected_workflow_revision is null
  then
    raise exception using
      errcode = '22023',
      message = 'Complete insurer-response identity is required.';
  end if;

  normalized_response_text := case
    when requested_response_text is null
      or pg_catalog.regexp_replace(
        requested_response_text,
        U&'[\0009\000A\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]',
        '',
        'g'
      ) = ''
    then null
    else requested_response_text
  end;

  if pg_catalog.char_length(normalized_response_text) > 100000
    or normalized_response_text ~
      U&'[\0001-\0008\000B\000C\000E-\001F\007F-\009F\061C\200E\200F\202A-\202E\2066-\2069]'
    or requested_revised_offer_minor_units <= 0
    or requested_revised_offer_minor_units > 9007199254740991
    or (
      requested_document_id is not null
      and requested_retained_document_id is not null
    )
    or (
      normalized_response_text is null
      and requested_revised_offer_minor_units is null
      and requested_document_id is null
      and requested_retained_document_id is null
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Insurer response content is invalid.';
  end if;

  if requested_document_id is not null
    and requested_document_id is distinct from requested_client_request_id
  then
    raise exception using
      errcode = '22023',
      message = 'The prepared document must match the client request identity.';
  end if;

  request_digest := public.total_loss_canonical_jsonb_digest(
    jsonb_build_object(
      'responseText', normalized_response_text,
      'revisedOfferMinorUnits', requested_revised_offer_minor_units,
      'documentId', requested_document_id,
      'retainedDocumentId', requested_retained_document_id,
      'supersedesResponseId', requested_supersedes_response_id
    )
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_insurer_response'),
    pg_catalog.hashtext(requested_case_id::text)
  );

  if not public.is_permanent_total_loss_case_owner(requested_case_id) then
    raise exception using
      errcode = '42501',
      message = 'Insurer response recording is unavailable.';
  end if;

  select event.* into event_row
  from public.total_loss_workflow_events as event
  where event.case_id = requested_case_id
    and event.client_request_id = requested_client_request_id;
  if found then
    if event_row.event_type <> 'insurer_response.recorded'
      or event_row.details ->> 'requestDigest' is distinct from request_digest
      or event_row.details ->> 'responseId' is null
      or event_row.details ->> 'workflowRevision' !~ '^[1-9][0-9]*$'
    then
      raise exception using
        errcode = '55000',
        message = 'Client request identity was already used.';
    end if;

    select workflow.* into workflow_row
    from public.total_loss_claim_workflows as workflow
    where workflow.case_id = requested_case_id;
    if not found
      or workflow_row.current_report_version_id is null
      or not public.total_loss_customer_report_access_internal(
        requested_case_id,
        workflow_row.current_report_version_id
      )
    then
      raise exception using
        errcode = '42501',
        message = 'Insurer response recording is unavailable.';
    end if;

    return jsonb_build_object(
      'state', 'insurer_response_received',
      'response', public.total_loss_insurer_response_projection_internal(
        requested_case_id,
        (event_row.details ->> 'responseId')::uuid
      ),
      'workflowRevision', (event_row.details ->> 'workflowRevision')::bigint
    );
  end if;

  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = requested_case_id
  for update;
  if not found
    or workflow_row.revision is distinct from expected_workflow_revision
    or workflow_row.current_task not in (
      'awaiting_insurer_response',
      'insurer_response_received'
    )
  then
    raise exception using
      errcode = '40001',
      message = 'Claim workflow changed before insurer response recording.';
  end if;

  if workflow_row.current_report_version_id is null
    or not public.total_loss_customer_report_access_internal(
      requested_case_id,
      workflow_row.current_report_version_id
    )
  then
    raise exception using
      errcode = '42501',
      message = 'Insurer response recording is unavailable.';
  end if;

  select report_version.* into report_row
  from public.total_loss_report_versions as report_version
  where report_version.id = workflow_row.current_report_version_id
    and report_version.case_id = requested_case_id
    and report_version.status = 'published';
  if not found then
    raise exception using
      errcode = '42501',
      message = 'Insurer response recording is unavailable.';
  end if;

  select negotiation_round.* into round_row
  from public.total_loss_negotiation_rounds as negotiation_round
  where negotiation_round.id = workflow_row.current_negotiation_round_id
    and negotiation_round.case_id = requested_case_id
  for update;
  if not found then
    raise exception using
      errcode = '55000',
      message = 'The active negotiation round is unavailable.';
  end if;

  if workflow_row.current_task = 'awaiting_insurer_response' then
    if requested_supersedes_response_id is not null
      or round_row.status <> 'waiting_for_insurer'
    then
      raise exception using
        errcode = '55000',
        message = 'The initial insurer response cannot supersede another response.';
    end if;
  else
    if requested_supersedes_response_id is null
      or round_row.status <> 'response_received'
    then
      raise exception using
        errcode = '55000',
        message = 'A correction must identify the current insurer response.';
    end if;

    select communication.* into superseded_response_row
    from public.total_loss_communications as communication
    where communication.id = requested_supersedes_response_id
      and communication.case_id = requested_case_id
      and communication.negotiation_round_id = round_row.id
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
      );
    if not found then
      raise exception using
        errcode = '55000',
        message = 'The insurer response correction target is stale.';
    end if;
  end if;

  if requested_document_id is null and exists (
    select 1
    from public.total_loss_claim_documents as prepared_document
    where prepared_document.id = requested_client_request_id
      and prepared_document.case_id = requested_case_id
      and prepared_document.document_kind = 'insurer_response'
      and prepared_document.status = 'pending'
  ) then
    raise exception using
      errcode = '55000',
      message = 'The prepared insurer-response upload must be attached.';
  end if;

  if requested_document_id is not null then
    select document.* into document_row
    from public.total_loss_claim_documents as document
    where document.id = requested_document_id
      and document.case_id = requested_case_id
      and document.document_kind = 'insurer_response'
      and document.status = 'pending'
      and document.created_by_user_id = authenticated_user_id
    for update;
    if not found then
      raise exception using
        errcode = '55000',
        message = 'The prepared insurer-response document is unavailable.';
    end if;

    select object.* into object_row
    from storage.objects as object
    where object.bucket_id = document_row.storage_bucket_id
      and object.name = document_row.storage_object_name
    for update;
    if not found
      or object_row.user_metadata is distinct from jsonb_build_object(
        'clientRequestId', requested_client_request_id::text,
        'originalName', document_row.original_filename,
        'contentDigest', document_row.content_digest
      )
      or jsonb_typeof(object_row.metadata) <> 'object'
      or object_row.metadata ->> 'mimetype' is distinct from document_row.media_type
      or object_row.metadata ->> 'size' !~ '^[0-9]+$'
      or (object_row.metadata ->> 'size')::bigint is distinct from document_row.byte_size
    then
      raise exception using
        errcode = '55000',
        message = 'The insurer-response upload is incomplete or does not match its permit.';
    end if;

    update public.total_loss_claim_documents
    set status = 'ready', sealed_at = recorded_at
    where id = document_row.id and status = 'pending'
    returning * into document_row;
    if not found then
      raise exception using
        errcode = '40001',
        message = 'The insurer-response document changed before sealing.';
    end if;
    effective_document_id := document_row.id;
  elsif requested_retained_document_id is not null then
    if requested_supersedes_response_id is null then
      raise exception using
        errcode = '22023',
        message = 'Only a correction can retain a prior response document.';
    end if;

    select document.* into document_row
    from public.total_loss_communication_documents as communication_document
    join public.total_loss_claim_documents as document
      on document.id = communication_document.document_id
      and document.case_id = communication_document.case_id
    where communication_document.case_id = requested_case_id
      and communication_document.communication_id = requested_supersedes_response_id
      and communication_document.document_id = requested_retained_document_id
      and document.document_kind = 'insurer_response'
      and document.status = 'ready';
    if not found then
      raise exception using
        errcode = '55000',
        message = 'The retained insurer-response document is unavailable.';
    end if;
    effective_document_id := document_row.id;
  end if;

  insert into public.total_loss_communications (
    case_id,
    negotiation_round_id,
    direction,
    channel,
    communication_type,
    status,
    original_content,
    occurred_at,
    recorded_by_user_id,
    supersedes_communication_id
  ) values (
    requested_case_id,
    round_row.id,
    'inbound',
    case when effective_document_id is null
      then 'pasted_message'::public.total_loss_communication_channel
      else 'uploaded_document'::public.total_loss_communication_channel
    end,
    'insurer_response',
    'draft',
    normalized_response_text,
    recorded_at,
    authenticated_user_id,
    requested_supersedes_response_id
  )
  returning * into communication_row;

  if effective_document_id is not null then
    insert into public.total_loss_communication_documents (
      case_id,
      communication_id,
      document_id,
      display_order
    ) values (
      requested_case_id,
      communication_row.id,
      effective_document_id,
      0
    );
  end if;

  update public.total_loss_communications
  set status = 'confirmed', confirmed_at = recorded_at
  where id = communication_row.id and status = 'draft'
  returning * into communication_row;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'The insurer response changed before confirmation.';
  end if;

  effective_offer_id := null;
  if requested_supersedes_response_id is not null then
    select offer.* into previous_offer_row
    from public.total_loss_offers as offer
    where offer.case_id = requested_case_id
      and offer.negotiation_round_id = round_row.id
      and offer.source_communication_id = requested_supersedes_response_id
      and offer.status = 'recorded'
    order by offer.received_at desc, offer.id desc
    limit 1;

    if workflow_row.current_offer_id is not null
      and previous_offer_row.id is distinct from workflow_row.current_offer_id
    then
      raise exception using
        errcode = '55000',
        message = 'The current insurer offer is unavailable.';
    end if;
  end if;

  if previous_offer_row.id is not null then
    update public.total_loss_offers
    set status = 'superseded',
        decided_at = recorded_at,
        decision_recorded_by_user_id = authenticated_user_id
    where id = previous_offer_row.id and status = 'recorded';
  end if;

  if requested_revised_offer_minor_units is not null then
    report_currency := coalesce(
      report_row.report #>> '{executiveConclusion,insurerValuation,value,currency}',
      report_row.report #>> '{executiveConclusion,supportedAdvertisedPriceRange,median,currency}'
    );
    if report_currency is null or report_currency !~ '^[A-Z]{3}$' then
      raise exception using
        errcode = '55000',
        message = 'The published report does not provide a supported offer currency.';
    end if;

    insert into public.total_loss_offers (
      case_id,
      negotiation_round_id,
      source_communication_id,
      amount_minor_units,
      currency,
      offer_kind,
      status,
      received_at,
      supersedes_offer_id
    ) values (
      requested_case_id,
      round_row.id,
      communication_row.id,
      requested_revised_offer_minor_units,
      report_currency,
      'revised_valuation',
      'recorded',
      recorded_at,
      previous_offer_row.id
    )
    returning * into offer_row;
    effective_offer_id := offer_row.id;
  end if;

  update public.total_loss_negotiation_rounds
  set status = 'response_received', revision = round_row.revision + 1
  where id = round_row.id and revision = round_row.revision
  returning * into round_row;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'The negotiation round changed before response recording.';
  end if;

  update public.total_loss_claim_workflows as workflow
  set phase = 'negotiation',
      current_task = 'insurer_response_received',
      current_offer_id = effective_offer_id,
      revision = workflow.revision + 1
  where workflow.case_id = requested_case_id
    and workflow.revision = expected_workflow_revision
  returning * into workflow_row;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'Claim workflow changed before insurer response recording.';
  end if;

  insert into public.total_loss_workflow_events (
    case_id,
    event_type,
    actor_type,
    actor_user_id,
    associated_entity_type,
    associated_entity_id,
    client_request_id,
    details
  ) values (
    requested_case_id,
    'insurer_response.recorded',
    'customer',
    authenticated_user_id,
    'total_loss_communication',
    communication_row.id,
    requested_client_request_id,
    jsonb_build_object(
      'requestDigest', request_digest,
      'responseId', communication_row.id,
      'negotiationRoundId', round_row.id,
      'documentId', effective_document_id,
      'offerId', effective_offer_id,
      'supersedesResponseId', requested_supersedes_response_id,
      'workflowRevision', workflow_row.revision
    )
  )
  returning * into event_row;

  return jsonb_build_object(
    'state', 'insurer_response_received',
    'response', public.total_loss_insurer_response_projection_internal(
      requested_case_id,
      communication_row.id
    ),
    'workflowRevision', workflow_row.revision
  );
end;
$$;

comment on function public.record_total_loss_insurer_response(uuid, uuid, text, bigint, uuid, uuid, uuid, bigint) is
  'Atomically records or idempotently replays one confirmed inbound insurer response, optional exact attachment, offer fact, round state, workflow task, and audit event.';

revoke execute on function public.record_total_loss_insurer_response(uuid, uuid, text, bigint, uuid, uuid, uuid, bigint)
  from public, anon, service_role;
grant execute on function public.record_total_loss_insurer_response(uuid, uuid, text, bigint, uuid, uuid, uuid, bigint)
  to authenticated;

alter type public.total_loss_case_claim_resume_result
  add attribute insurer_response jsonb;

-- Keep purchase identity projections neutral when the current permanent
-- account no longer matches the saved contact email. Ownership, transfer,
-- payment, and fulfillment decisions remain unchanged.

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
  attempt_row public.checkout_attempts%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  report_row public.total_loss_report_versions%rowtype;
  result_row public.total_loss_case_claim_resume_result;
  safe_task text;
  next_state text;
  fulfillment_state text;
  fulfillment_retryable boolean := false;
  optional_skipped boolean := false;
  result_completed boolean := false;
  insurer_review_completed boolean := false;
  valuation_completed boolean := false;
  report_completed boolean := false;
  what_next_completed boolean := false;
  entitled_report boolean := false;
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
    select checkout_attempt.* into attempt_row
    from public.checkout_attempts as checkout_attempt
    where checkout_attempt.order_id = order_row.id
    order by checkout_attempt.created_at desc, checkout_attempt.id desc limit 1;
    select entitlement.* into entitlement_row
    from public.case_entitlements as entitlement
    where entitlement.order_id = order_row.id;
  end if;
  if workflow_row.current_package_job_id is not null then
    select * into package_row from public.total_loss_package_jobs
    where id = workflow_row.current_package_job_id
      and case_id = requested_case_id;
  end if;
  if workflow_row.current_report_version_id is not null then
    select * into report_row from public.total_loss_report_versions
    where id = workflow_row.current_report_version_id
      and case_id = requested_case_id;
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
      'report_reviewing', 'refund_pending', 'report_revision_required',
      'finalizing', 'purchase_complete', 'package_queued'
    ) then 'finalizing'
    when workflow_row.current_task in ('exception_review', 'report_failed')
      then 'exception_review'
    when workflow_row.current_task in ('report_ready', 'prepare_request')
      then workflow_row.current_task
    when workflow_row.current_task = 'no_dispute_resolved' then 'no_dispute_supported'
    when workflow_row.current_task = 'awaiting_insurer_response'
      then 'awaiting_insurer_response'
    when workflow_row.current_task = 'insurer_response_received'
      then 'insurer_response_received'
    else workflow_row.current_task
  end;

  entitled_report := result_row.state = 'secured'
    and report_row.id is not null
    and public.total_loss_customer_report_access_internal(
      requested_case_id, report_row.id
    );

  if entitled_report then
    select
      bool_or(progress.skipped_at is not null)
        filter (where progress.step_identifier in ('insurer_review', 'valuation', 'report', 'what_next')),
      bool_or(progress.completed_at is not null)
        filter (where progress.step_identifier = 'result'),
      bool_or(progress.completed_at is not null)
        filter (where progress.step_identifier = 'insurer_review'),
      bool_or(progress.completed_at is not null)
        filter (where progress.step_identifier = 'valuation'),
      bool_or(progress.completed_at is not null)
        filter (where progress.step_identifier = 'report'),
      bool_or(progress.completed_at is not null)
        filter (where progress.step_identifier = 'what_next')
    into optional_skipped, result_completed, insurer_review_completed,
      valuation_completed, report_completed, what_next_completed
    from public.total_loss_education_progress as progress
    where progress.case_id = requested_case_id
      and progress.report_version_id = report_row.id;
    optional_skipped := coalesce(optional_skipped, false);
    result_completed := coalesce(result_completed, false);
    insurer_review_completed := coalesce(insurer_review_completed, false);
    valuation_completed := coalesce(valuation_completed, false);
    report_completed := coalesce(report_completed, false);
    what_next_completed := coalesce(what_next_completed, false);
  end if;

  fulfillment_state := case
    when workflow_row.case_id is null then 'not_started'
    when entitlement_row.status in ('suspended', 'revoked')
      then 'needs_attention'
    when workflow_row.current_task = 'refund_pending'
      and entitled_report
      and report_row.report #>> '{executiveConclusion,continuationStatus}'
        <> 'SUPPORTS_CONTINUATION'
      then 'refund_pending'
    when entitlement_row.id is null and order_row.status = 'void'
      then 'needs_attention'
    when entitlement_row.id is null and order_row.id is not null then 'payment_pending'
    when safe_task = 'finalizing' then 'finalizing'
    when safe_task = 'exception_review' then 'exception_review'
    when safe_task in ('report_ready', 'prepare_request') then 'report_ready'
    when safe_task = 'no_dispute_supported' then 'no_dispute'
    when safe_task = 'awaiting_insurer_response' then 'awaiting_insurer_response'
    when safe_task = 'insurer_response_received' then 'insurer_response_received'
    when safe_task = 'secure_claim' then 'not_started'
    else 'needs_attention'
  end;
  fulfillment_retryable := coalesce(package_row.status = 'retryable_failed', false);

  next_state := case
    when result_row.state <> 'secured' then 'secure_claim'
    when workflow_row.case_id is null then null
    when entitlement_row.status in ('suspended', 'revoked') then 'needs_attention'
    when entitlement_row.id is null and order_row.status = 'void'
      then 'needs_attention'
    when entitlement_row.id is null and attempt_row.status = 'complete'
      then 'checkout_confirmation'
    when entitlement_row.id is null then 'checkout'
    when safe_task = 'awaiting_insurer_response' then 'awaiting_insurer_response'
    when safe_task = 'insurer_response_received' then 'insurer_response_received'
    when safe_task = 'no_dispute_supported' then 'no_dispute'
    when workflow_row.current_task = 'refund_pending'
      and entitled_report
      and report_row.report #>> '{executiveConclusion,continuationStatus}'
        <> 'SUPPORTS_CONTINUATION'
      then 'no_dispute'
    when safe_task in ('finalizing', 'exception_review') then 'processing'
    when safe_task not in ('report_ready', 'prepare_request') then 'needs_attention'
    when not entitled_report then 'needs_attention'
    when report_row.report #>> '{executiveConclusion,continuationStatus}'
      <> 'SUPPORTS_CONTINUATION' then 'no_dispute'
    when not result_completed then 'guide_result'
    when safe_task = 'prepare_request' or optional_skipped then 'prepare_request'
    when not insurer_review_completed then 'guide_insurer_review'
    when not valuation_completed then 'guide_valuation'
    when not report_completed then 'guide_report'
    when not what_next_completed then 'guide_what_next'
    else 'prepare_request'
  end;

  result_row.case_id := requested_case_id;
  result_row.contact_email := case
    when result_row.state = 'account_mismatch' then null
    else contact_row.email
  end;
  result_row.workflow_phase := workflow_row.phase::text;
  result_row.workflow_current_task := safe_task;
  result_row.workflow_revision := workflow_row.revision;
  result_row.checkout_available := coalesce((
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
  ), false);
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
    result_row.commerce_amount_minor_units := order_row.amount_minor_units;
    result_row.commerce_currency := order_row.currency;
    if workflow_row.case_id is null then
      result_row.checkout_available := false;
      result_row.commerce_order_status := null;
      result_row.payment_status := null;
      result_row.entitlement_status := null;
      result_row.next_task := null;
      result_row.commerce_amount_minor_units := null;
      result_row.commerce_currency := null;
      result_row.customer_journey := null;
      result_row.insurer_response := null;
    else
      result_row.customer_journey := jsonb_build_object(
        'nextState', next_state,
        'fulfillmentState', fulfillment_state,
        'retryable', fulfillment_retryable
      );
      if safe_task = 'insurer_response_received' then
        result_row.insurer_response :=
          public.total_loss_current_insurer_response_projection_internal(
            requested_case_id
          );
      else
        result_row.insurer_response := null;
      end if;
      if entitled_report then
        result_row.published_report :=
          public.total_loss_customer_report_projection_internal(report_row.id);
        result_row.education_progress :=
          public.total_loss_customer_education_projection_internal(
            requested_case_id, report_row.id
          );
        result_row.sending_details :=
          public.total_loss_customer_sending_projection_internal(
            requested_case_id, report_row.id
          );
        if report_row.report #>> '{executiveConclusion,continuationStatus}'
            = 'SUPPORTS_CONTINUATION'
        then
          result_row.message_draft :=
            public.total_loss_customer_message_draft_projection_internal(
              requested_case_id, report_row.id
            );
        end if;
      end if;
    end if;
  else
    result_row.commerce_order_status := null;
    result_row.payment_status := null;
    result_row.entitlement_status := null;
    result_row.next_task := null;
    result_row.commerce_amount_minor_units := null;
    result_row.commerce_currency := null;
    result_row.customer_journey := jsonb_build_object(
      'nextState', 'secure_claim',
      'fulfillmentState', 'not_started',
      'retryable', false
    );
    result_row.insurer_response := null;
  end if;
  return next result_row;
end;
$$;

notify pgrst, 'reload schema';
