-- A new inbound communication starts the next round only after the customer's
-- latest outbound is confirmed sent. Corrections stay within their source round.
drop trigger total_loss_response_after_follow_up_guard on public.total_loss_communications;
drop function public.reject_total_loss_response_after_follow_up();
drop trigger total_loss_response_upload_after_follow_up_guard on public.total_loss_claim_documents;
drop function public.reject_total_loss_response_upload_after_follow_up();

create unique index total_loss_negotiation_rounds_origin_unique
  on public.total_loss_negotiation_rounds(originating_communication_id)
  where originating_communication_id is not null;
create unique index total_loss_response_one_original_per_round
  on public.total_loss_communications(negotiation_round_id)
  where direction='inbound' and communication_type='insurer_response'
    and supersedes_communication_id is null;

create table public.total_loss_insurer_response_upload_sources (
  document_id uuid primary key,
  case_id uuid not null,
  outbound_communication_id uuid not null,
  supersedes_response_id uuid,
  foreign key(document_id,case_id) references public.total_loss_claim_documents(id,case_id),
  foreign key(outbound_communication_id,case_id) references public.total_loss_communications(id,case_id),
  foreign key(supersedes_response_id,case_id) references public.total_loss_communications(id,case_id)
);
alter table public.total_loss_insurer_response_upload_sources enable row level security;
revoke all on public.total_loss_insurer_response_upload_sources from public,anon,authenticated,service_role;
create trigger total_loss_response_upload_sources_immutable before update or delete
  on public.total_loss_insurer_response_upload_sources for each row execute function public.reject_total_loss_immutable_record();

-- Existing permits are confined to their original round and cannot move forward.
insert into public.total_loss_insurer_response_upload_sources(document_id,case_id,outbound_communication_id,supersedes_response_id)
select document.id,document.case_id,round.originating_communication_id,response.supersedes_communication_id
from public.total_loss_claim_documents document
left join lateral (
  select communication.* from public.total_loss_communication_documents link
  join public.total_loss_communications communication on communication.id=link.communication_id and communication.case_id=link.case_id
  where link.document_id=document.id and link.case_id=document.case_id order by communication.created_at,communication.id limit 1
) response on true
join public.total_loss_negotiation_rounds round on round.case_id=document.case_id
  and (round.id=response.negotiation_round_id or (response.id is null and round.round_number=1))
where document.document_kind='insurer_response' and round.originating_communication_id is not null;

create function public.total_loss_response_intake_context_internal(requested_case_id uuid,requested_supersedes_response_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare workflow_row public.total_loss_claim_workflows%rowtype;
  round_row public.total_loss_negotiation_rounds%rowtype; outbound_row public.total_loss_communications%rowtype;
begin
  select * into workflow_row from public.total_loss_claim_workflows where case_id=$1;
  select * into round_row from public.total_loss_negotiation_rounds
    where id=workflow_row.current_negotiation_round_id and case_id=$1 and status<>'closed';
  if round_row.id is null then return null; end if;
  if requested_supersedes_response_id is not null then
    if workflow_row.current_task<>'insurer_response_received'
      or round_row.status not in ('response_received','preparing_follow_up')
      or not exists(select 1 from public.total_loss_communications response
        where response.id=$2 and response.case_id=$1 and response.negotiation_round_id=round_row.id
          and response.direction='inbound' and response.communication_type='insurer_response' and response.status='confirmed'
          and not exists(select 1 from public.total_loss_communications successor where successor.supersedes_communication_id=response.id))
      or exists(select 1 from public.total_loss_communications where case_id=$1 and negotiation_round_id=round_row.id
        and communication_type='follow_up_reconsideration_request' and direction='outbound' and status='confirmed')
    then return null; end if;
    select * into outbound_row from public.total_loss_communications where id=round_row.originating_communication_id and case_id=$1;
  else
    if workflow_row.current_task<>'awaiting_insurer_response' or round_row.status<>'waiting_for_insurer'
      or exists(select 1 from public.total_loss_insurer_response_decisions where case_id=$1
        and recommendation_id=workflow_row.current_recommendation_id and choice='ACCEPT_OFFER')
    then return null; end if;
    if not exists(select 1 from public.total_loss_communications where case_id=$1 and negotiation_round_id=round_row.id
      and direction='inbound' and communication_type='insurer_response' and status='confirmed') then
      select * into outbound_row from public.total_loss_communications where id=round_row.originating_communication_id and case_id=$1;
    else
      select communication.* into outbound_row from public.total_loss_communications communication
      join public.total_loss_message_versions message on message.id=communication.message_version_id and message.case_id=$1
        and message.message_state='customer_reported_sent'
      join public.total_loss_follow_up_sources source on source.message_draft_id=message.message_draft_id and source.case_id=$1
        and source.recommendation_id=workflow_row.current_recommendation_id
      join public.total_loss_insurer_response_decisions decision on decision.id=source.decision_id and decision.choice='CONTINUE_CHALLENGING'
      where communication.case_id=$1 and communication.negotiation_round_id=round_row.id
        and communication.direction='outbound' and communication.communication_type='follow_up_reconsideration_request'
        and communication.status='confirmed';
    end if;
  end if;
  if outbound_row.id is null or outbound_row.direction<>'outbound' or outbound_row.status<>'confirmed'
    or not exists(select 1 from public.total_loss_message_versions where id=outbound_row.message_version_id
      and case_id=$1 and message_state='customer_reported_sent' and report_version_id=workflow_row.current_report_version_id)
  then return null; end if;
  return jsonb_build_object('negotiationRoundId',round_row.id,'outboundCommunicationId',outbound_row.id);
end;
$$;
revoke execute on function public.total_loss_response_intake_context_internal(uuid,uuid) from public,anon,authenticated,service_role;

create function public.record_total_loss_insurer_response(
  requested_case_id uuid,
  requested_client_request_id uuid,
  requested_response_text text,
  requested_revised_offer_minor_units bigint,
  requested_document_id uuid,
  requested_retained_document_id uuid,
  requested_supersedes_response_id uuid,
  expected_workflow_revision bigint,
  requested_outbound_communication_id uuid
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
  intake_context jsonb;
  next_round_number integer;
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
  if requested_outbound_communication_id is null or authenticated_user_id is null
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

    if not exists(select 1 from public.total_loss_communications response
      join public.total_loss_negotiation_rounds round on round.id=response.negotiation_round_id and round.case_id=response.case_id
      where response.id=(event_row.details ->> 'responseId')::uuid and response.case_id=requested_case_id
        and round.originating_communication_id=requested_outbound_communication_id) then
      raise exception using errcode='55000',message='Client request identity was already used.';
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

  intake_context:=public.total_loss_response_intake_context_internal(requested_case_id,requested_supersedes_response_id);
  if intake_context is null or intake_context ->> 'outboundCommunicationId' is distinct from requested_outbound_communication_id::text then
    raise exception using errcode='55000',message='The insurer response source is no longer current.';
  end if;
  if requested_supersedes_response_id is null and round_row.originating_communication_id<>requested_outbound_communication_id then
    next_round_number:=round_row.round_number+1;
    update public.total_loss_negotiation_rounds set status='closed',closed_at=recorded_at,revision=revision+1 where id=round_row.id;
    insert into public.total_loss_negotiation_rounds(case_id,round_number,status,originating_communication_id)
      values(requested_case_id,next_round_number,'waiting_for_insurer',requested_outbound_communication_id) returning * into round_row;
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
      or round_row.status not in ('response_received','preparing_follow_up')
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
      and exists(select 1 from public.total_loss_insurer_response_upload_sources source
        where source.document_id=document.id and source.case_id=requested_case_id
          and source.outbound_communication_id=requested_outbound_communication_id
          and source.supersedes_response_id is not distinct from requested_supersedes_response_id)
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
      current_negotiation_round_id = round_row.id,
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
      'outboundCommunicationId', requested_outbound_communication_id,
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

revoke execute on function public.record_total_loss_insurer_response(uuid,uuid,text,bigint,uuid,uuid,uuid,bigint,uuid) from public,anon,service_role;
grant execute on function public.record_total_loss_insurer_response(uuid,uuid,text,bigint,uuid,uuid,uuid,bigint,uuid) to authenticated;

-- The original signature remains confined to initial-round compatibility.
create or replace function public.record_total_loss_insurer_response(
  requested_case_id uuid,requested_client_request_id uuid,requested_response_text text,requested_revised_offer_minor_units bigint,
  requested_document_id uuid,requested_retained_document_id uuid,requested_supersedes_response_id uuid,expected_workflow_revision bigint
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare origin uuid;
begin
  if not public.is_permanent_total_loss_case_owner($1) then
    raise exception using errcode='42501',message='Insurer response recording is unavailable.'; end if;
  if exists(select 1 from public.total_loss_communications where case_id=$1 and communication_type='follow_up_reconsideration_request'
    and status='confirmed') and not exists(select 1 from public.total_loss_workflow_events where case_id=$1
      and client_request_id=$2 and event_type='insurer_response.recorded') then
    raise exception using errcode='55000',message='The next insurer response is not available in this case stage.'; end if;
  select originating_communication_id into origin from public.total_loss_negotiation_rounds where case_id=$1 and round_number=1;
  return public.record_total_loss_insurer_response($1,$2,$3,$4,$5,$6,$7,$8,origin);
end;
$$;

alter function public.prepare_total_loss_insurer_response_upload(uuid,uuid,text,text,bigint,text,bigint)
  rename to prepare_total_loss_insurer_response_upload_internal;
revoke execute on function public.prepare_total_loss_insurer_response_upload_internal(uuid,uuid,text,text,bigint,text,bigint)
  from public,anon,authenticated,service_role;

create function public.prepare_total_loss_insurer_response_upload(
  requested_case_id uuid,requested_client_request_id uuid,requested_original_filename text,requested_media_type text,
  requested_byte_size bigint,requested_content_digest text,expected_workflow_revision bigint,
  requested_outbound_communication_id uuid,requested_supersedes_response_id uuid
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare source_row public.total_loss_insurer_response_upload_sources%rowtype; context jsonb; projection jsonb; sealed boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_insurer_response'),pg_catalog.hashtext($1::text));
  if not public.is_permanent_total_loss_case_owner($1) or not public.total_loss_customer_report_access_internal($1,
    (select current_report_version_id from public.total_loss_claim_workflows where case_id=$1)) then
    raise exception using errcode='42501',message='Insurer-response upload is unavailable.'; end if;
  select * into source_row from public.total_loss_insurer_response_upload_sources where document_id=$2;
  if found and (source_row.case_id<>$1 or source_row.outbound_communication_id is distinct from $8
    or source_row.supersedes_response_id is distinct from $9) then
    raise exception using errcode='55000',message='Client request identity was already used.'; end if;
  select status='ready' into sealed from public.total_loss_claim_documents where id=$2 and case_id=$1;
  context:=public.total_loss_response_intake_context_internal($1,$9);
  if sealed is not true and (context is null or context ->> 'outboundCommunicationId' is distinct from $8::text) then
    raise exception using errcode='55000',message='The insurer response source is no longer current.'; end if;
  projection:=public.prepare_total_loss_insurer_response_upload_internal($1,$2,$3,$4,$5,$6,$7);
  if source_row.document_id is null then
    insert into public.total_loss_insurer_response_upload_sources(document_id,case_id,outbound_communication_id,supersedes_response_id)
      values($2,$1,$8,$9);
  end if;
  return projection;
end;
$$;
revoke execute on function public.prepare_total_loss_insurer_response_upload(uuid,uuid,text,text,bigint,text,bigint,uuid,uuid) from public,anon,service_role;
grant execute on function public.prepare_total_loss_insurer_response_upload(uuid,uuid,text,text,bigint,text,bigint,uuid,uuid) to authenticated;

create function public.prepare_total_loss_insurer_response_upload(
  requested_case_id uuid,requested_client_request_id uuid,requested_original_filename text,requested_media_type text,
  requested_byte_size bigint,requested_content_digest text,expected_workflow_revision bigint
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare origin uuid; supersedes uuid;
begin
  if not public.is_permanent_total_loss_case_owner($1) then
    raise exception using errcode='42501',message='Insurer-response upload is unavailable.'; end if;
  if exists(select 1 from public.total_loss_communications where case_id=$1 and communication_type='follow_up_reconsideration_request'
    and status='confirmed') then
    raise exception using errcode='55000',message='The next insurer response is not available in this case stage.'; end if;
  select originating_communication_id into origin from public.total_loss_negotiation_rounds where case_id=$1 and round_number=1;
  select supersedes_response_id into supersedes from public.total_loss_insurer_response_upload_sources where document_id=$2;
  if not found then
    select (public.total_loss_current_insurer_response_projection_internal($1)->>'responseId')::uuid into supersedes
      from public.total_loss_claim_workflows where case_id=$1 and current_task='insurer_response_received';
  end if;
  return public.prepare_total_loss_insurer_response_upload($1,$2,$3,$4,$5,$6,$7,origin,supersedes);
end;
$$;
revoke execute on function public.prepare_total_loss_insurer_response_upload(uuid,uuid,text,text,bigint,text,bigint) from public,anon,service_role;
grant execute on function public.prepare_total_loss_insurer_response_upload(uuid,uuid,text,text,bigint,text,bigint) to authenticated;

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
      and exists(select 1 from public.total_loss_insurer_response_upload_sources source
        where source.document_id=document.id and source.case_id=document.case_id
          and public.total_loss_response_intake_context_internal(document.case_id,source.supersedes_response_id)
            ->> 'outboundCommunicationId'=source.outbound_communication_id::text)
      and public.total_loss_customer_report_access_internal(document.case_id,
        (select current_report_version_id from public.total_loss_claim_workflows where case_id=document.case_id))
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

create or replace function public.total_loss_enqueue_response_analysis_on_workflow_update()
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

  if old.current_response_analysis_job_id is not null
    and old.current_negotiation_round_id=new.current_negotiation_round_id then
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

create or replace function public.resolve_total_loss_follow_up_generation_context(
  requested_case_id uuid,requested_user_id uuid,requested_decision_id uuid
) returns jsonb language sql stable security definer set search_path='' as $$
  with source as (
    select jsonb_build_object(
      'sourceIdentity',jsonb_build_object(
        'caseId',workflow.case_id,'responseId',response.id,'analysisResultId',result.id,
        'recommendationId',recommendation.id,'decisionId',decision.id,'reportId',report.id,
        'finalAssessmentId',assessment.id,'initialCommunicationId',origin.id,
        'initialPreparedMessageId',message.id,'outboundCommunicationId',origin.id,'outboundPreparedMessageId',message.id,'decision',decision.choice,
        'assessmentDigest',assessment.assessment_digest,'reportDigest',report.report_digest,
        'analysisResultDigest',result.result_digest,'evidenceIndexDigest',result.evidence_index_digest,
        'recommendationDigest',recommendation.recommendation_digest,
        'initialMessageDigest',message.message_digest,'negotiationRoundId',round.id),
      'analysis',result.result,'evidenceIndex',result.evidence_index,
      'recommendation',recommendation.recommendation,'finalAssessment',assessment.assessment,
      'report',report.report,
      'initialRequest',jsonb_build_object('recipientEmail',message.recipient,'subject',message.subject,'body',message.body),
      'sendingDetails',public.total_loss_customer_sending_projection_internal(workflow.case_id,report.id),
      'customerOffer',case when offer.id is null or recommendation.recommendation #>> '{offer,source}' = 'RESPONSE_TEXT'
        then null else jsonb_build_object('offerId',offer.id,'amountMinorUnits',offer.amount_minor_units,
          'currency',offer.currency,'sourceCommunicationId',offer.source_communication_id) end
    ) as value
    from public.total_loss_claim_workflows workflow
    join public.total_loss_insurer_response_analysis_jobs job
      on job.id=workflow.current_response_analysis_job_id and job.case_id=workflow.case_id and job.status='completed'
    join public.total_loss_insurer_response_analysis_results result on result.job_id=job.id and result.case_id=job.case_id
    join public.total_loss_communications response on response.id=result.response_communication_id and response.case_id=workflow.case_id
      and response.status='confirmed' and response.direction='inbound' and response.communication_type='insurer_response'
    join public.total_loss_recommendations recommendation on recommendation.id=workflow.current_recommendation_id
      and recommendation.source_analysis_result_id=result.id and recommendation.case_id=workflow.case_id
      and recommendation.status='published'
    join public.total_loss_insurer_response_decisions decision on decision.id=$3 and decision.case_id=workflow.case_id
      and decision.recommendation_id=recommendation.id and decision.analysis_result_id=result.id
      and decision.response_communication_id=response.id and decision.choice='CONTINUE_CHALLENGING'
    join public.total_loss_report_versions report on report.id=workflow.current_report_version_id
      and report.id=job.source_report_version_id and report.id=recommendation.source_report_version_id
      and report.case_id=workflow.case_id and report.status='published'
    join public.total_loss_final_assessments assessment on assessment.id=report.final_assessment_id
      and assessment.id=recommendation.source_final_assessment_id and assessment.case_id=workflow.case_id
    join public.total_loss_negotiation_rounds round on round.id=workflow.current_negotiation_round_id
      and round.id=job.negotiation_round_id and round.case_id=workflow.case_id and round.status<>'closed'
    join public.total_loss_communications origin on origin.id=round.originating_communication_id
      and origin.case_id=workflow.case_id and origin.communication_type in ('initial_reconsideration_request','follow_up_reconsideration_request')
      and origin.direction='outbound' and origin.status='confirmed'
    join public.total_loss_message_versions message on message.id=origin.message_version_id
      and message.id=job.source_message_version_id and message.case_id=workflow.case_id
      and message.report_version_id=report.id and message.message_state='customer_reported_sent'
    left join public.total_loss_offers offer on offer.id=recommendation.source_offer_id and offer.case_id=workflow.case_id
      and offer.source_communication_id=response.id and offer.status='recorded'
    where workflow.case_id=$1 and workflow.current_task in ('insurer_response_received','awaiting_insurer_response')
      and public.total_loss_customer_report_access_for_user_internal(workflow.case_id,report.id,$2)
      and recommendation.source_analysis_result_digest=result.result_digest
      and recommendation.source_evidence_index_digest=result.evidence_index_digest
      and recommendation.source_report_digest=report.report_digest
      and recommendation.source_assessment_digest=assessment.assessment_digest
      and (recommendation.source_offer_id is null or offer.id=workflow.current_offer_id)
      and not exists(select 1 from public.total_loss_communications successor
        where successor.case_id=workflow.case_id and successor.supersedes_communication_id=response.id and successor.status='confirmed')
  ) select value || jsonb_build_object('contextDigest',public.total_loss_canonical_jsonb_digest(value)) from source;
$$;
-- Once assigned, a round always answers the same sent outbound communication.
create function public.protect_total_loss_round_origin()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.originating_communication_id is not null and new.originating_communication_id is distinct from old.originating_communication_id then
    raise exception using errcode='55000',message='The negotiation round source is immutable.'; end if;
  return new;
end;
$$;
revoke execute on function public.protect_total_loss_round_origin() from public,anon,authenticated,service_role;
create trigger total_loss_round_origin_immutable before update on public.total_loss_negotiation_rounds
  for each row execute function public.protect_total_loss_round_origin();

alter function public.total_loss_insurer_response_projection_internal(uuid,uuid)
  rename to total_loss_insurer_response_projection_before_rounds;
revoke execute on function public.total_loss_insurer_response_projection_before_rounds(uuid,uuid) from public,anon,authenticated,service_role;
create function public.total_loss_insurer_response_projection_internal(requested_case_id uuid,requested_response_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare projection jsonb; response_row public.total_loss_communications%rowtype;
  round_row public.total_loss_negotiation_rounds%rowtype; result_row public.total_loss_insurer_response_analysis_results%rowtype;
begin
  projection:=public.total_loss_insurer_response_projection_before_rounds($1,$2);
  if projection is null then return null; end if;
  select * into response_row from public.total_loss_communications where id=$2 and case_id=$1;
  select * into round_row from public.total_loss_negotiation_rounds where id=response_row.negotiation_round_id and case_id=$1;
  -- Correction supersession stops work; completed evidence remains revisitable.
  select * into result_row from public.total_loss_insurer_response_analysis_results where response_communication_id=$2 and case_id=$1;
  if result_row.id is not null then
    projection:=projection || jsonb_build_object('processingState','completed','failureReason',null,'analysis',result_row.result,'analysisEvidence',result_row.evidence_index);
  end if;
  return projection || jsonb_build_object('negotiationRoundId',round_row.id,
    'outboundCommunicationId',round_row.originating_communication_id,
    'canCorrect',public.total_loss_response_intake_context_internal($1,$2) is not null);
end;
$$;
revoke execute on function public.total_loss_insurer_response_projection_internal(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.total_loss_current_insurer_response_projection_internal(requested_case_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select public.total_loss_insurer_response_projection_internal($1,response.id)
  from public.total_loss_claim_workflows workflow
  join public.total_loss_communications response on response.case_id=workflow.case_id
    and response.negotiation_round_id=workflow.current_negotiation_round_id
    and response.direction='inbound' and response.communication_type='insurer_response' and response.status='confirmed'
  where workflow.case_id=$1 and not exists(select 1 from public.total_loss_communications successor
    where successor.case_id=$1 and successor.supersedes_communication_id=response.id and successor.status='confirmed');
$$;

create function public.total_loss_sent_communication_projection_internal(requested_case_id uuid,requested_communication_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select public.total_loss_customer_message_version_projection_internal(message.id) || jsonb_build_object(
    'state','sent','customerReportedSentAt',message.sent_at,'communicationId',communication.id,
    'negotiationRoundId',communication.negotiation_round_id)
  from public.total_loss_communications communication
  join public.total_loss_message_versions message on message.id=communication.message_version_id and message.case_id=communication.case_id
    and message.message_state='customer_reported_sent'
  where communication.case_id=$1 and communication.id=$2 and communication.direction='outbound' and communication.status='confirmed';
$$;
revoke execute on function public.total_loss_sent_communication_projection_internal(uuid,uuid) from public,anon,authenticated,service_role;

create function public.total_loss_negotiation_history_projection_internal(requested_case_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'negotiationRoundId',round.id,'roundNumber',round.round_number,
    'outbound',public.total_loss_sent_communication_projection_internal($1,round.originating_communication_id),
    'responses',coalesce((
      with recursive chain as (
        select response.id,response.supersedes_communication_id,0 as ordinal
        from public.total_loss_communications response where response.case_id=$1 and response.negotiation_round_id=round.id
          and response.direction='inbound' and response.communication_type='insurer_response' and response.status='confirmed'
          and response.supersedes_communication_id is null
        union all
        select successor.id,successor.supersedes_communication_id,chain.ordinal+1 from chain
        join public.total_loss_communications successor on successor.supersedes_communication_id=chain.id and successor.case_id=$1
          and successor.negotiation_round_id=round.id and successor.status='confirmed'
      ) select jsonb_agg(public.total_loss_insurer_response_projection_internal($1,chain.id) order by chain.ordinal) from chain
    ),'[]'::jsonb),
    'followUp',(
      select public.total_loss_sent_communication_projection_internal($1,communication.id)
      from public.total_loss_communications communication where communication.case_id=$1 and communication.negotiation_round_id=round.id
        and communication.direction='outbound' and communication.communication_type='follow_up_reconsideration_request'
        and communication.status='confirmed'
    )
  ) order by round.round_number),'[]'::jsonb)
  from public.total_loss_negotiation_rounds round where round.case_id=$1;
$$;
revoke execute on function public.total_loss_negotiation_history_projection_internal(uuid) from public,anon,authenticated,service_role;

alter type public.total_loss_case_claim_resume_result add attribute response_intake jsonb;
alter type public.total_loss_case_claim_resume_result add attribute negotiation_history jsonb;
alter function public.resolve_total_loss_case_claim(uuid) rename to resolve_total_loss_case_claim_before_rounds;
revoke execute on function public.resolve_total_loss_case_claim_before_rounds(uuid) from public,anon,authenticated,service_role;
create function public.resolve_total_loss_case_claim(requested_case_id uuid)
returns setof public.total_loss_case_claim_resume_result language plpgsql stable security definer set search_path='' as $$
declare result_row public.total_loss_case_claim_resume_result;
begin
  select * into result_row from public.resolve_total_loss_case_claim_before_rounds($1);
  if not found then return; end if;
  if result_row.state='secured' and result_row.published_report is not null
    and result_row.customer_journey ->> 'nextState' in ('awaiting_insurer_response','insurer_response_received',
      'insurer_response_reviewing','insurer_response_reviewed','insurer_response_review_unavailable','follow_up_preparation')
    and public.total_loss_customer_report_access_internal($1,(select current_report_version_id from public.total_loss_claim_workflows where case_id=$1)) then
    result_row.response_intake:=public.total_loss_response_intake_context_internal($1,null);
    result_row.negotiation_history:=public.total_loss_negotiation_history_projection_internal($1);
  end if;
  return next result_row;
end;
$$;
revoke execute on function public.resolve_total_loss_case_claim(uuid) from public,anon,service_role;
grant execute on function public.resolve_total_loss_case_claim(uuid) to authenticated;

-- An exact sent retry remains read-only after subsequent rounds have started.
alter function public.confirm_total_loss_customer_follow_up_sent(uuid,uuid,uuid,bigint,boolean)
  rename to confirm_total_loss_customer_follow_up_sent_internal;
revoke execute on function public.confirm_total_loss_customer_follow_up_sent_internal(uuid,uuid,uuid,bigint,boolean)
  from public,anon,authenticated,service_role;
create function public.confirm_total_loss_customer_follow_up_sent(
  requested_case_id uuid,requested_message_version_id uuid,requested_client_request_id uuid,
  expected_workflow_revision bigint,confirmed_report_attached boolean
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare sent_row public.total_loss_message_versions%rowtype; communication_row public.total_loss_communications%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
begin
  if requested_client_request_id is null or confirmed_report_attached is distinct from true then
    raise exception using errcode='22023',message='Sent confirmation requires the attached-report acknowledgement.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_insurer_response'),pg_catalog.hashtext($1::text));
  select * into workflow_row from public.total_loss_claim_workflows where case_id=$1 for update;
  if not public.is_permanent_total_loss_case_owner($1)
    or not public.total_loss_customer_report_access_internal($1,workflow_row.current_report_version_id) then
    raise exception using errcode='42501',message='Follow-up sent confirmation is unavailable.'; end if;
  select * into sent_row from public.total_loss_message_versions where case_id=$1
    and purpose='follow_up_reconsideration' and message_state='customer_reported_sent'
    and supersedes_message_version_id=$2;
  if found then
    if exists(select 1 from public.total_loss_workflow_events where case_id=$1 and client_request_id=$3
      and (event_type<>'follow_up.customer_reported_sent' or details ->> 'preparedMessageVersionId' is distinct from $2::text)) then
      raise exception using errcode='55000',message='Client request identity was already used.'; end if;
    select * into communication_row from public.total_loss_communications where message_version_id=sent_row.id and case_id=$1 and status='confirmed';
    return jsonb_build_object('state','awaiting_insurer_response','messageVersionId',sent_row.id,'communicationId',communication_row.id,
      'negotiationRoundId',communication_row.negotiation_round_id,'customerReportedSentAt',sent_row.sent_at,'workflowRevision',workflow_row.revision);
  end if;
  return public.confirm_total_loss_customer_follow_up_sent_internal($1,$2,$3,$4,$5);
end;
$$;
revoke execute on function public.confirm_total_loss_customer_follow_up_sent(uuid,uuid,uuid,bigint,boolean) from public,anon,service_role;
grant execute on function public.confirm_total_loss_customer_follow_up_sent(uuid,uuid,uuid,bigint,boolean) to authenticated;


-- Unusable permits from earlier responses cannot exhaust the next intake's capacity.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.prepare_total_loss_insurer_response_upload_internal(uuid,uuid,text,text,bigint,text,bigint)'::regprocedure) into definition;
  if position('and document.id <> requested_client_request_id' in definition)=0 then
    raise exception 'The upload capacity contract changed.';
  end if;
  execute replace(definition,'and document.id <> requested_client_request_id',
    'and document.id <> requested_client_request_id
    and exists(select 1 from public.total_loss_insurer_response_upload_sources source
      where source.document_id=document.id and source.case_id=document.case_id
        and public.total_loss_response_intake_context_internal(document.case_id,source.supersedes_response_id)
          ->> ''outboundCommunicationId''=source.outbound_communication_id::text)');
end;
$$;

notify pgrst,'reload schema';
