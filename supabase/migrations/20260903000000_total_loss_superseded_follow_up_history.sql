-- Preserve unsent follow-up drafts as read-only negotiation history when a
-- corrected insurer response makes their source review non-current.
create function public.total_loss_superseded_follow_up_drafts_projection_internal(
  requested_case_id uuid,
  requested_negotiation_round_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'state', 'superseded',
        'sourceResponseId', source.response_communication_id,
        'sourceAnalysisResultId', source.analysis_result_id,
        'sourceDecisionId', source.decision_id,
        'draft', jsonb_build_object(
          'draftId', draft.id,
          'reportVersionId', draft.report_version_id,
          'purpose', draft.purpose,
          'recipient', draft.recipient,
          'subject', draft.subject,
          'body', draft.body,
          'revision', draft.revision,
          'updatedAt', draft.updated_at
        )
      )
      order by source.created_at, source.decision_id
    ),
    '[]'::jsonb
  )
  from public.total_loss_follow_up_sources as source
  join public.total_loss_message_drafts as draft
    on draft.id = source.message_draft_id
    and draft.case_id = source.case_id
    and draft.negotiation_round_id = requested_negotiation_round_id
    and draft.report_version_id = source.report_version_id
    and draft.purpose = 'follow_up_reconsideration'
  join public.total_loss_insurer_response_decisions as decision
    on decision.id = source.decision_id
    and decision.case_id = source.case_id
    and decision.response_communication_id = source.response_communication_id
    and decision.analysis_result_id = source.analysis_result_id
    and decision.recommendation_id = source.recommendation_id
    and decision.choice = 'CONTINUE_CHALLENGING'
  join public.total_loss_insurer_response_analysis_results as analysis_result
    on analysis_result.id = source.analysis_result_id
    and analysis_result.case_id = source.case_id
    and analysis_result.response_communication_id = source.response_communication_id
  join public.total_loss_communications as response
    on response.id = source.response_communication_id
    and response.case_id = source.case_id
    and response.negotiation_round_id = requested_negotiation_round_id
    and response.direction = 'inbound'
    and response.communication_type = 'insurer_response'
    and response.status = 'confirmed'
  where source.case_id = requested_case_id
    and exists (
      select 1
      from public.total_loss_communications as successor
      where successor.case_id = source.case_id
        and successor.negotiation_round_id = requested_negotiation_round_id
        and successor.supersedes_communication_id = response.id
        and successor.direction = 'inbound'
        and successor.communication_type = 'insurer_response'
        and successor.status = 'confirmed'
    )
    and not exists (
      select 1
      from public.total_loss_message_versions as sent_version
      where sent_version.case_id = source.case_id
        and sent_version.message_draft_id = source.message_draft_id
        and sent_version.message_state = 'customer_reported_sent'
    );
$$;

revoke execute on function public.total_loss_superseded_follow_up_drafts_projection_internal(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.total_loss_negotiation_history_projection_internal(
  requested_case_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'negotiationRoundId', round.id,
    'roundNumber', round.round_number,
    'outbound', public.total_loss_sent_communication_projection_internal(
      requested_case_id,
      round.originating_communication_id
    ),
    'responses', coalesce((
      with recursive chain as (
        select response.id, response.supersedes_communication_id, 0 as ordinal
        from public.total_loss_communications as response
        where response.case_id = requested_case_id
          and response.negotiation_round_id = round.id
          and response.direction = 'inbound'
          and response.communication_type = 'insurer_response'
          and response.status = 'confirmed'
          and response.supersedes_communication_id is null
        union all
        select successor.id, successor.supersedes_communication_id, chain.ordinal + 1
        from chain
        join public.total_loss_communications as successor
          on successor.supersedes_communication_id = chain.id
          and successor.case_id = requested_case_id
          and successor.negotiation_round_id = round.id
          and successor.status = 'confirmed'
      )
      select jsonb_agg(
        public.total_loss_insurer_response_projection_internal(
          requested_case_id,
          chain.id
        )
        order by chain.ordinal
      )
      from chain
    ), '[]'::jsonb),
    'followUp', (
      select public.total_loss_sent_communication_projection_internal(
        requested_case_id,
        communication.id
      )
      from public.total_loss_communications as communication
      where communication.case_id = requested_case_id
        and communication.negotiation_round_id = round.id
        and communication.direction = 'outbound'
        and communication.communication_type = 'follow_up_reconsideration_request'
        and communication.status = 'confirmed'
    ),
    'supersededFollowUpDrafts',
      public.total_loss_superseded_follow_up_drafts_projection_internal(
        requested_case_id,
        round.id
      )
  ) order by round.round_number), '[]'::jsonb)
  from public.total_loss_negotiation_rounds as round
  where round.case_id = requested_case_id;
$$;

revoke execute on function public.total_loss_negotiation_history_projection_internal(uuid)
  from public, anon, authenticated, service_role;

-- The shared email-open boundary remains unchanged for the initial request,
-- but a follow-up version must still be the exact prepared version of the
-- current actionable draft. This prevents an already-open tab from acting on
-- a prepared version after its response source has been corrected.
create or replace function public.record_total_loss_customer_email_opened(
  requested_case_id uuid,
  requested_message_version_id uuid,
  requested_client_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  message_row public.total_loss_message_versions%rowtype;
  event_row public.total_loss_workflow_events%rowtype;
  follow_up_projection jsonb;
begin
  if requested_case_id is null or requested_message_version_id is null
    or requested_client_request_id is null
  then
    raise exception using errcode = '22023', message = 'Email-open request is invalid.';
  end if;
  select * into message_row from public.total_loss_message_versions
  where id = requested_message_version_id
    and case_id = requested_case_id
    and message_state = 'prepared';
  if not found
    or message_row.report_version_id is null
    or not public.total_loss_customer_report_access_internal(
      requested_case_id, message_row.report_version_id
    )
  then
    raise exception using errcode = '42501', message = 'Prepared message is unavailable.';
  end if;

  if message_row.purpose = 'follow_up_reconsideration' then
    follow_up_projection := public.total_loss_follow_up_projection_internal(
      requested_case_id
    );
    if follow_up_projection is null
      or follow_up_projection ->> 'state' is distinct from 'draft'
      or follow_up_projection #>> '{draft,draftId}'
        is distinct from message_row.message_draft_id::text
      or follow_up_projection #>> '{draft,revision}'
        is distinct from message_row.source_draft_revision::text
      or follow_up_projection #>> '{preparedMessage,messageVersionId}'
        is distinct from message_row.id::text
      or row(
        follow_up_projection #>> '{draft,recipient}',
        follow_up_projection #>> '{draft,subject}',
        follow_up_projection #>> '{draft,body}'
      ) is distinct from row(
        message_row.recipient,
        message_row.subject,
        message_row.body
      )
    then
      raise exception using errcode = '42501', message = 'Prepared message is unavailable.';
    end if;
  end if;

  insert into public.total_loss_workflow_events (
    case_id, event_type, actor_type, actor_user_id,
    associated_entity_type, associated_entity_id, client_request_id
  ) values (
    requested_case_id, 'message.email_app_opened', 'customer', (select auth.uid()),
    'total_loss_message_version', requested_message_version_id,
    requested_client_request_id
  ) on conflict (case_id, client_request_id)
    where client_request_id is not null
    do nothing
  returning * into event_row;

  if not found then
    select * into event_row from public.total_loss_workflow_events
    where case_id = requested_case_id
      and client_request_id = requested_client_request_id;
    if event_row.event_type <> 'message.email_app_opened'
      or event_row.associated_entity_id is distinct from requested_message_version_id
    then
      raise exception using errcode = '55000', message = 'Client request identity was already used.';
    end if;
  end if;

  return jsonb_build_object(
    'status', 'opened',
    'eventId', event_row.id,
    'messageVersionId', requested_message_version_id,
    'authoritativeSent', false
  );
end;
$$;

comment on function public.record_total_loss_customer_email_opened(uuid, uuid, uuid) is
  'Records only a non-authoritative external email-app-open event; a follow-up must still be current.';

revoke execute on function public.record_total_loss_customer_email_opened(uuid, uuid, uuid)
  from public, anon, service_role;
grant execute on function public.record_total_loss_customer_email_opened(uuid, uuid, uuid)
  to authenticated;
