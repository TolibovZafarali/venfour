-- Authorize a short-lived download of the immutable original attached to one
-- submitted response. Storage identities remain inside the service boundary.
create function public.authorize_total_loss_insurer_response_original_download(
  requested_case_id uuid,
  requested_response_id uuid,
  requested_user_id uuid
)
returns table (
  case_id uuid,
  response_id uuid,
  document_id uuid,
  storage_owner_id uuid,
  media_type text,
  storage_bucket_id text,
  storage_object_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    communication.case_id,
    communication.id,
    document.id,
    details.report_storage_owner_id,
    document.media_type,
    document.storage_bucket_id,
    document.storage_object_name
  from public.total_loss_communications as communication
  join public.total_loss_communication_documents as attachment
    on attachment.communication_id = communication.id
    and attachment.case_id = communication.case_id
  join public.total_loss_claim_documents as document
    on document.id = attachment.document_id
    and document.case_id = communication.case_id
    and document.document_kind = 'insurer_response'
    and document.status = 'ready'
    and document.sealed_at is not null
  join public.total_loss_case_details as details
    on details.case_id = communication.case_id
  join public.total_loss_claim_workflows as workflow
    on workflow.case_id = communication.case_id
  where communication.case_id = $1
    and communication.id = $2
    and communication.direction = 'inbound'
    and communication.communication_type = 'insurer_response'
    and communication.status = 'confirmed'
    and public.total_loss_customer_report_access_for_user_internal(
      $1, workflow.current_report_version_id, $3
    )
    and document.storage_bucket_id = 'case-files'
    and document.storage_object_name = details.report_storage_owner_id::text
      || '/' || communication.case_id::text || '/insurer-responses/'
      || document.id::text || '.'
      || public.total_loss_insurer_response_canonical_extension(document.media_type)
  order by attachment.display_order, document.id
  limit 1;
$$;

comment on function public.authorize_total_loss_insurer_response_original_download(uuid, uuid, uuid) is
  'Service-only exact-owner and entitlement-aware locator for a sealed submitted insurer-response original, including superseded corrections.';

revoke execute on function public.authorize_total_loss_insurer_response_original_download(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.authorize_total_loss_insurer_response_original_download(uuid, uuid, uuid)
  to service_role;
