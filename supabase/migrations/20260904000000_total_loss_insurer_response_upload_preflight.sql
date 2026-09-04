-- Supabase Storage authorizes a standard upload before the bytes are stored.
-- That preflight row exposes the declared byte length as metadata.contentLength;
-- the completed object is later written with the authoritative metadata.size.
-- Keep permit admission and final sealing as separate checks for those stages.

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
      and exists (
        select 1
        from public.total_loss_insurer_response_upload_sources as source
        where source.document_id = document.id
          and source.case_id = document.case_id
          and public.total_loss_response_intake_context_internal(
            document.case_id,
            source.supersedes_response_id
          ) ->> 'outboundCommunicationId' =
            source.outbound_communication_id::text
      )
      and public.total_loss_customer_report_access_internal(
        document.case_id,
        (
          select workflow.current_report_version_id
          from public.total_loss_claim_workflows as workflow
          where workflow.case_id = document.case_id
        )
      )
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
      and jsonb_typeof($3 -> 'contentLength') = 'number'
      and $3 -> 'contentLength' = pg_catalog.to_jsonb(document.byte_size)
      and document.media_type is not null
      and document.byte_size between 1 and 10485760
      and document.content_digest ~ '^[0-9a-f]{64}$'
  );
$$;

comment on function public.authorize_total_loss_insurer_response_document_mutation(text, jsonb, jsonb) is
  'Authorizes one exact owner and lineage-bound pending insurer-response upload from numeric preflight metadata.contentLength; completed metadata.size remains mandatory at sealing.';

revoke execute on function public.authorize_total_loss_insurer_response_document_mutation(text, jsonb, jsonb)
  from public, anon, service_role;
grant execute on function public.authorize_total_loss_insurer_response_document_mutation(text, jsonb, jsonb)
  to authenticated;
