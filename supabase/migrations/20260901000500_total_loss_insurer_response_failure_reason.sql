-- Keep the customer response projection truthful without exposing provider or
-- worker failure codes. Earlier response-analysis migrations may already be
-- applied, so this is a forward-only projection upgrade.

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
  failure_reason text;
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
    failure_reason := case
      when job_row.status = 'unsupported' then 'unsupported_document'
      when job_row.status = 'terminal_failed'
        and job_row.failure_code = 'INSURER_RESPONSE_MATERIAL_UNREADABLE'
        then 'unreadable_document'
      when job_row.status in (
        'retryable_failed', 'terminal_failed', 'superseded'
      ) then 'generic'
      else null
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
    'failureReason', failure_reason,
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
  'Customer-safe current response and structured interpretation; only stable failure categories are exposed, while storage, job, run, provider, model, prompt, usage, digest, and technical failure metadata are omitted.';

revoke execute on function public.total_loss_insurer_response_projection_internal(uuid, uuid)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
