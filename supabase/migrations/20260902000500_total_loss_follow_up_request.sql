-- Continue decisions prepare a distinct response-bound message using the existing
-- editable drafts, immutable versions, outbound records and first round.
create table public.total_loss_follow_up_sources (
  decision_id uuid primary key references public.total_loss_insurer_response_decisions(id),
  case_id uuid not null references public.total_loss_claim_workflows(case_id),
  message_draft_id uuid not null unique,
  response_communication_id uuid not null,
  analysis_result_id uuid not null,
  recommendation_id uuid not null,
  report_version_id uuid not null,
  final_assessment_id uuid not null,
  initial_communication_id uuid not null,
  initial_message_version_id uuid not null,
  context_digest text not null check (context_digest ~ '^[0-9a-f]{64}$'),
  generation jsonb not null check (generation ->> 'status' = 'READY'),
  created_at timestamptz not null default statement_timestamp(),
  foreign key(message_draft_id,case_id) references public.total_loss_message_drafts(id,case_id),
  foreign key(response_communication_id,case_id) references public.total_loss_communications(id,case_id),
  foreign key(analysis_result_id,case_id) references public.total_loss_insurer_response_analysis_results(id,case_id),
  foreign key(recommendation_id,case_id) references public.total_loss_recommendations(id,case_id),
  foreign key(report_version_id,case_id) references public.total_loss_report_versions(id,case_id),
  foreign key(final_assessment_id,case_id) references public.total_loss_final_assessments(id,case_id),
  foreign key(initial_communication_id,case_id) references public.total_loss_communications(id,case_id),
  foreign key(initial_message_version_id,case_id) references public.total_loss_message_versions(id,case_id)
);
create trigger total_loss_follow_up_sources_reject_mutation before update or delete
  on public.total_loss_follow_up_sources for each row execute function public.reject_total_loss_immutable_record();
alter table public.total_loss_follow_up_sources enable row level security;
revoke all on public.total_loss_follow_up_sources from public,anon,authenticated,service_role;

-- A failed attempt is retained for refresh; retrying with newly available inputs
-- records a new attempt without overwriting a successful draft or customer edits.
create table public.total_loss_follow_up_generation_blocks (
  case_id uuid not null references public.total_loss_claim_workflows(case_id),
  decision_id uuid not null references public.total_loss_insurer_response_decisions(id),
  context_digest text not null check(context_digest ~ '^[0-9a-f]{64}$'),
  generation jsonb not null check(generation ->> 'status' = 'BLOCKED'),
  created_at timestamptz not null default statement_timestamp(),
  primary key(decision_id,context_digest)
);
create trigger total_loss_follow_up_generation_blocks_reject_mutation before update or delete
  on public.total_loss_follow_up_generation_blocks for each row execute function public.reject_total_loss_immutable_record();
alter table public.total_loss_follow_up_generation_blocks enable row level security;
revoke all on public.total_loss_follow_up_generation_blocks from public,anon,authenticated,service_role;

drop index public.total_loss_message_drafts_one_current_idx;
create unique index total_loss_message_drafts_one_current_idx on public.total_loss_message_drafts(
  case_id,purpose,coalesce(negotiation_round_id,'00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(report_version_id,'00000000-0000-0000-0000-000000000000'::uuid)
) where purpose <> 'follow_up_reconsideration';
alter table public.total_loss_message_versions add column source_draft_revision bigint
  check(source_draft_revision is null or source_draft_revision>0);

create unique index total_loss_follow_up_message_one_sent_idx on public.total_loss_message_versions(message_draft_id)
  where purpose='follow_up_reconsideration' and message_state='customer_reported_sent';

create function public.resolve_total_loss_follow_up_generation_context(
  requested_case_id uuid,requested_user_id uuid,requested_decision_id uuid
) returns jsonb language sql stable security definer set search_path='' as $$
  with source as (
    select jsonb_build_object(
      'sourceIdentity',jsonb_build_object(
        'caseId',workflow.case_id,'responseId',response.id,'analysisResultId',result.id,
        'recommendationId',recommendation.id,'decisionId',decision.id,'reportId',report.id,
        'finalAssessmentId',assessment.id,'initialCommunicationId',origin.id,
        'initialPreparedMessageId',message.id,'decision',decision.choice,
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
      and round.id=job.negotiation_round_id and round.case_id=workflow.case_id and round.round_number=1 and round.status<>'closed'
    join public.total_loss_communications origin on origin.id=round.originating_communication_id
      and origin.case_id=workflow.case_id and origin.communication_type='initial_reconsideration_request'
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
revoke execute on function public.resolve_total_loss_follow_up_generation_context(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.resolve_total_loss_follow_up_generation_context(uuid,uuid,uuid) to service_role;

create function public.total_loss_follow_up_projection_internal(requested_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare decision_row public.total_loss_insurer_response_decisions%rowtype;
  source_row public.total_loss_follow_up_sources%rowtype; draft_row public.total_loss_message_drafts%rowtype;
  version_row public.total_loss_message_versions%rowtype; sent_row public.total_loss_message_versions%rowtype;
  communication_row public.total_loss_communications%rowtype; block_row public.total_loss_follow_up_generation_blocks%rowtype;
  context jsonb; projection jsonb;
begin
  select decision.* into decision_row from public.total_loss_insurer_response_decisions decision
    join public.total_loss_claim_workflows workflow on workflow.case_id=decision.case_id
      and workflow.current_recommendation_id=decision.recommendation_id
    where decision.case_id=$1 and decision.choice='CONTINUE_CHALLENGING';
  if decision_row.id is null then return null; end if;
  select * into source_row from public.total_loss_follow_up_sources where decision_id=decision_row.id;
  context:=public.resolve_total_loss_follow_up_generation_context($1,(select user_id from public.appraisal_cases where id=$1),decision_row.id);
  projection:=jsonb_build_object('state','available','decisionId',decision_row.id,'responseId',decision_row.response_communication_id,
    'analysisResultId',decision_row.analysis_result_id,'reportVersionId',coalesce(source_row.report_version_id,(context #>> '{sourceIdentity,reportId}')::uuid,
      (select source_report_version_id from public.total_loss_recommendations where id=decision_row.recommendation_id)),
    'draft',null,'preparedMessage',null,'sentMessage',null,'reasonCode',null);
  if context is null and source_row.message_draft_id is null then
    return projection || jsonb_build_object('state','unavailable','reasonCode','FOLLOW_UP_SOURCE_UNAVAILABLE'); end if;
  if source_row.message_draft_id is null then
    select * into block_row from public.total_loss_follow_up_generation_blocks where decision_id=decision_row.id
      and context_digest=context ->> 'contextDigest';
    if block_row.decision_id is not null then return projection || jsonb_build_object('state','unavailable',
      'reasonCode',block_row.generation ->> 'blockedReasonCode'); end if;
    return projection;
  end if;
  select * into draft_row from public.total_loss_message_drafts where id=source_row.message_draft_id;
  select * into version_row from public.total_loss_message_versions where message_draft_id=draft_row.id
    and message_state='prepared' order by version_number desc limit 1;
  select * into sent_row from public.total_loss_message_versions where message_draft_id=draft_row.id and message_state='customer_reported_sent';
  select * into communication_row from public.total_loss_communications where message_version_id=sent_row.id and status='confirmed';
  if context is null and sent_row.id is null then return projection || jsonb_build_object(
    'state','unavailable','reasonCode','FOLLOW_UP_SOURCE_UNAVAILABLE'); end if;
  return projection || jsonb_build_object('state',case when sent_row.id is null then 'draft' else 'sent' end,
    'draft',jsonb_build_object('draftId',draft_row.id,'reportVersionId',draft_row.report_version_id,'purpose',draft_row.purpose,
      'recipient',draft_row.recipient,'subject',draft_row.subject,'body',draft_row.body,'revision',draft_row.revision,'updatedAt',draft_row.updated_at),
    'preparedMessage',public.total_loss_customer_message_version_projection_internal(version_row.id),
    'sentMessage',case when sent_row.id is null then null else public.total_loss_customer_message_version_projection_internal(sent_row.id)
      || jsonb_build_object('state','sent','customerReportedSentAt',sent_row.sent_at,'communicationId',communication_row.id,
        'negotiationRoundId',communication_row.negotiation_round_id) end);
end;
$$;
revoke execute on function public.total_loss_follow_up_projection_internal(uuid) from public,anon,authenticated,service_role;

create function public.get_total_loss_customer_follow_up(requested_case_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select public.total_loss_follow_up_projection_internal($1) from public.total_loss_claim_workflows workflow
  where workflow.case_id=$1 and public.total_loss_customer_report_access_internal($1,workflow.current_report_version_id);
$$;
revoke execute on function public.get_total_loss_customer_follow_up(uuid) from public,anon,service_role;
grant execute on function public.get_total_loss_customer_follow_up(uuid) to authenticated;

create function public.store_total_loss_follow_up_draft(
  requested_case_id uuid,requested_user_id uuid,requested_decision_id uuid,
  expected_context_digest text,requested_generation jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare context jsonb; source_row public.total_loss_follow_up_sources%rowtype;
  draft_row public.total_loss_message_drafts%rowtype; workflow_row public.total_loss_claim_workflows%rowtype;
  identity jsonb; generation_status text:=requested_generation ->> 'status';
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_insurer_response'),pg_catalog.hashtext(requested_case_id::text));
  select * into workflow_row from public.total_loss_claim_workflows where case_id=requested_case_id for update;
  context:=public.resolve_total_loss_follow_up_generation_context(requested_case_id,requested_user_id,requested_decision_id);
  if context is null then raise exception using errcode='42501',message='Follow-up sources are unavailable.'; end if;
  select * into source_row from public.total_loss_follow_up_sources where decision_id=requested_decision_id;
  if found then return public.total_loss_follow_up_projection_internal(requested_case_id); end if;
  if context ->> 'contextDigest' is distinct from expected_context_digest then
    raise exception using errcode='40001',message='Follow-up sources changed before generation was saved.'; end if;
  if generation_status is null or generation_status not in ('READY','BLOCKED')
    or requested_generation ->> 'schemaVersion' is distinct from '1'
    or requested_generation ->> 'templateVersion' is distinct from '1'
    or requested_generation ->> 'generationDigest' is null
    or requested_generation ->> 'generationDigest' !~ '^[0-9a-f]{64}$'
    or pg_column_size(requested_generation)>262144 then
    raise exception using errcode='22023',message='Follow-up generation is invalid.'; end if;
  if generation_status='BLOCKED' then
    if nullif(requested_generation ->> 'blockedReasonCode','') is null
      or requested_generation ->> 'blockedReasonCode' !~ '^[A-Z][A-Z0-9_]{0,95}$'
      or requested_generation ->> 'body' is not null then
      raise exception using errcode='22023',message='Blocked follow-up reason is invalid.'; end if;
    insert into public.total_loss_follow_up_generation_blocks(case_id,decision_id,context_digest,generation)
      values(requested_case_id,requested_decision_id,expected_context_digest,requested_generation)
      on conflict(decision_id,context_digest) do nothing;
    return public.total_loss_follow_up_projection_internal(requested_case_id);
  end if;
  if requested_generation ->> 'recipientEmail' is null
    or requested_generation ->> 'recipientEmail' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or char_length(requested_generation ->> 'recipientEmail') not between 3 and 320
    or requested_generation ->> 'subject' is null or char_length(btrim(requested_generation ->> 'subject')) not between 1 and 998
    or requested_generation ->> 'subject' ~ '[[:cntrl:]]'
    or requested_generation ->> 'body' is null or char_length(btrim(requested_generation ->> 'body')) not between 1 and 50000
    or public.total_loss_response_analysis_evidence_index_is_valid(context -> 'evidenceIndex',jsonb_build_object(
      'responseEvidenceRefs',requested_generation #> '{grounding,responseEvidenceRefs}',
      'caseEvidenceRefs',requested_generation #> '{grounding,caseEvidenceRefs}')) is not true then
    raise exception using errcode='22023',message='Follow-up generated content is invalid.'; end if;
  identity:=context -> 'sourceIdentity';
  insert into public.total_loss_message_drafts(case_id,negotiation_round_id,report_version_id,purpose,recipient,subject,body,
    generated_recipient,generated_subject,generated_body,generation_template_version)
  values(requested_case_id,(identity ->> 'negotiationRoundId')::uuid,(identity ->> 'reportId')::uuid,'follow_up_reconsideration',
    requested_generation ->> 'recipientEmail',requested_generation ->> 'subject',requested_generation ->> 'body',
    requested_generation ->> 'recipientEmail',requested_generation ->> 'subject',requested_generation ->> 'body','follow-up-v1') returning * into draft_row;
  insert into public.total_loss_follow_up_sources(decision_id,case_id,message_draft_id,response_communication_id,analysis_result_id,
    recommendation_id,report_version_id,final_assessment_id,initial_communication_id,initial_message_version_id,context_digest,generation)
  values(requested_decision_id,requested_case_id,draft_row.id,(identity ->> 'responseId')::uuid,(identity ->> 'analysisResultId')::uuid,
    (identity ->> 'recommendationId')::uuid,(identity ->> 'reportId')::uuid,(identity ->> 'finalAssessmentId')::uuid,
    (identity ->> 'initialCommunicationId')::uuid,(identity ->> 'initialPreparedMessageId')::uuid,expected_context_digest,requested_generation);
  update public.total_loss_negotiation_rounds set status='preparing_follow_up',revision=revision+1
    where id=draft_row.negotiation_round_id;
  insert into public.total_loss_workflow_events(case_id,event_type,actor_type,associated_entity_type,associated_entity_id,details)
    values(requested_case_id,'follow_up.draft_generated','system','total_loss_message_draft',draft_row.id,
      jsonb_build_object('decisionId',requested_decision_id,'responseId',identity -> 'responseId','contextDigest',expected_context_digest));
  return public.total_loss_follow_up_projection_internal(requested_case_id);
end;
$$;
revoke execute on function public.store_total_loss_follow_up_draft(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.store_total_loss_follow_up_draft(uuid,uuid,uuid,text,jsonb) to service_role;

create function public.patch_total_loss_customer_follow_up_draft(
  requested_case_id uuid,requested_draft_id uuid,requested_recipient text,requested_subject text,requested_body text,expected_revision bigint
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare projection jsonb; draft_row public.total_loss_message_drafts%rowtype;
  normalized_recipient text:=lower(btrim(coalesce(requested_recipient,''))); normalized_subject text:=btrim(coalesce(requested_subject,''));
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_insurer_response'),pg_catalog.hashtext(requested_case_id::text));
  perform 1 from public.total_loss_claim_workflows where case_id=requested_case_id for update;
  projection:=public.get_total_loss_customer_follow_up(requested_case_id);
  if projection ->> 'state' is distinct from 'draft' or projection #>> '{draft,draftId}' is distinct from requested_draft_id::text then
    raise exception using errcode='42501',message='Follow-up draft is unavailable.'; end if;
  if normalized_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(normalized_recipient) not between 3 and 320
    or char_length(normalized_subject) not between 1 and 998 or normalized_subject ~ '[[:cntrl:]]'
    or requested_body is null or char_length(btrim(requested_body)) not between 1 and 50000 then
    raise exception using errcode='22023',message='Message draft content is invalid.'; end if;
  update public.total_loss_message_drafts set recipient=normalized_recipient,
    subject=normalized_subject,body=requested_body,revision=revision+1
    where id=requested_draft_id and case_id=requested_case_id and revision=expected_revision returning * into draft_row;
  if not found then raise exception using errcode='40001',message='Message draft changed before this edit.'; end if;
  return public.get_total_loss_customer_follow_up(requested_case_id) -> 'draft';
end;
$$;
revoke execute on function public.patch_total_loss_customer_follow_up_draft(uuid,uuid,text,text,text,bigint) from public,anon,service_role;
grant execute on function public.patch_total_loss_customer_follow_up_draft(uuid,uuid,text,text,text,bigint) to authenticated;

create function public.prepare_total_loss_customer_follow_up(
  requested_case_id uuid,requested_draft_id uuid,requested_client_request_id uuid,expected_revision bigint,expected_workflow_revision bigint
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare projection jsonb; draft_row public.total_loss_message_drafts%rowtype; version_row public.total_loss_message_versions%rowtype;
  previous_row public.total_loss_message_versions%rowtype; workflow_row public.total_loss_claim_workflows%rowtype;
begin
  if requested_client_request_id is null then raise exception using errcode='22023',message='Message preparation request is invalid.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_insurer_response'),pg_catalog.hashtext(requested_case_id::text));
  select * into workflow_row from public.total_loss_claim_workflows where case_id=requested_case_id for update;
  projection:=public.get_total_loss_customer_follow_up(requested_case_id);
  if projection ->> 'state' is distinct from 'draft' or projection #>> '{draft,draftId}' is distinct from requested_draft_id::text then
    raise exception using errcode='42501',message='Follow-up draft is unavailable.'; end if;
  select * into draft_row from public.total_loss_message_drafts where id=requested_draft_id and case_id=requested_case_id for update;
  if draft_row.revision is distinct from expected_revision or workflow_row.revision is distinct from expected_workflow_revision then
    raise exception using errcode='40001',message='Message draft changed before preparation.'; end if;
  select * into version_row from public.total_loss_message_versions where case_id=requested_case_id and client_request_id=requested_client_request_id;
  if found then
    if version_row.message_draft_id<>draft_row.id or version_row.message_state<>'prepared'
      or version_row.source_draft_revision is distinct from draft_row.revision
      or row(version_row.recipient,version_row.subject,version_row.body) is distinct from row(draft_row.recipient,draft_row.subject,draft_row.body) then
      raise exception using errcode='55000',message='Client request identity was already used.'; end if;
  else
    select * into previous_row from public.total_loss_message_versions where message_draft_id=draft_row.id order by version_number desc limit 1;
    insert into public.total_loss_message_versions(case_id,message_draft_id,negotiation_round_id,report_version_id,version_number,message_state,
      purpose,recipient,subject,body,message_digest,supersedes_message_version_id,client_request_id,source_draft_revision)
    values(requested_case_id,draft_row.id,draft_row.negotiation_round_id,draft_row.report_version_id,coalesce(previous_row.version_number,0)+1,'prepared',
      draft_row.purpose,draft_row.recipient,draft_row.subject,draft_row.body,
      public.total_loss_message_digest_internal(draft_row.recipient,draft_row.subject,draft_row.body),previous_row.id,requested_client_request_id,draft_row.revision)
      returning * into version_row;
    insert into public.total_loss_workflow_events(case_id,event_type,actor_type,actor_user_id,associated_entity_type,associated_entity_id,client_request_id,details)
      values(requested_case_id,'follow_up.prepared','customer',(select auth.uid()),'total_loss_message_version',version_row.id,requested_client_request_id,
        jsonb_build_object('draftId',draft_row.id,'draftRevision',draft_row.revision,'decisionId',projection -> 'decisionId','responseId',projection -> 'responseId'));
  end if;
  return jsonb_build_object('draft',projection -> 'draft','messageVersion',public.total_loss_customer_message_version_projection_internal(version_row.id),
    'workflowRevision',workflow_row.revision);
end;
$$;
revoke execute on function public.prepare_total_loss_customer_follow_up(uuid,uuid,uuid,bigint,bigint) from public,anon,service_role;
grant execute on function public.prepare_total_loss_customer_follow_up(uuid,uuid,uuid,bigint,bigint) to authenticated;

create function public.confirm_total_loss_customer_follow_up_sent(
  requested_case_id uuid,requested_message_version_id uuid,requested_client_request_id uuid,expected_workflow_revision bigint,confirmed_report_attached boolean
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare projection jsonb; prepared_row public.total_loss_message_versions%rowtype; sent_row public.total_loss_message_versions%rowtype;
  draft_row public.total_loss_message_drafts%rowtype; workflow_row public.total_loss_claim_workflows%rowtype;
  communication_row public.total_loss_communications%rowtype; source_row public.total_loss_follow_up_sources%rowtype;
  next_number integer;
begin
  if requested_client_request_id is null or confirmed_report_attached is distinct from true then
    raise exception using errcode='22023',message='Sent confirmation requires the attached-report acknowledgement.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_insurer_response'),pg_catalog.hashtext(requested_case_id::text));
  select * into workflow_row from public.total_loss_claim_workflows where case_id=requested_case_id for update;
  projection:=public.get_total_loss_customer_follow_up(requested_case_id);
  if projection is null or projection ->> 'state' not in ('draft','sent') then
    raise exception using errcode='42501',message='Follow-up sent confirmation is unavailable.'; end if;
  if public.resolve_total_loss_follow_up_generation_context(requested_case_id,(select auth.uid()),
      (projection ->> 'decisionId')::uuid) is null then
    raise exception using errcode='42501',message='Follow-up sources are unavailable.'; end if;
  select * into prepared_row from public.total_loss_message_versions where id=requested_message_version_id and case_id=requested_case_id and message_state='prepared';
  if prepared_row.id is null or prepared_row.message_draft_id::text is distinct from projection #>> '{draft,draftId}' then
    raise exception using errcode='42501',message='Prepared follow-up is unavailable.'; end if;
  select * into sent_row from public.total_loss_message_versions where case_id=requested_case_id and client_request_id=requested_client_request_id;
  if found and (sent_row.message_state<>'customer_reported_sent' or sent_row.supersedes_message_version_id is distinct from prepared_row.id) then
    raise exception using errcode='55000',message='Client request identity was already used.'; end if;
  select * into sent_row from public.total_loss_message_versions where message_draft_id=prepared_row.message_draft_id and message_state='customer_reported_sent';
  if found then
    if sent_row.supersedes_message_version_id is distinct from prepared_row.id then
      raise exception using errcode='55000',message='A different follow-up version was already recorded as sent.'; end if;
    select * into communication_row from public.total_loss_communications where message_version_id=sent_row.id and status='confirmed';
  else
    if workflow_row.revision is distinct from expected_workflow_revision then
      raise exception using errcode='40001',message='Claim workflow changed before sent confirmation.'; end if;
    select * into draft_row from public.total_loss_message_drafts where id=prepared_row.message_draft_id for update;
    if draft_row.revision is distinct from prepared_row.source_draft_revision
      or row(draft_row.recipient,draft_row.subject,draft_row.body) is distinct from row(prepared_row.recipient,prepared_row.subject,prepared_row.body)
      or public.total_loss_message_digest_internal(draft_row.recipient,draft_row.subject,draft_row.body) is distinct from prepared_row.message_digest then
      raise exception using errcode='40001',message='Message draft changed after this version was prepared.'; end if;
    select * into source_row from public.total_loss_follow_up_sources where message_draft_id=draft_row.id;
    select coalesce(max(version_number),0)+1 into next_number from public.total_loss_message_versions where message_draft_id=draft_row.id;
    insert into public.total_loss_message_versions(case_id,message_draft_id,negotiation_round_id,report_version_id,version_number,message_state,
      purpose,recipient,subject,body,message_digest,supersedes_message_version_id,sent_at,client_request_id,source_draft_revision)
    values(requested_case_id,draft_row.id,draft_row.negotiation_round_id,draft_row.report_version_id,next_number,'customer_reported_sent',
      draft_row.purpose,prepared_row.recipient,prepared_row.subject,prepared_row.body,prepared_row.message_digest,prepared_row.id,
      statement_timestamp(),requested_client_request_id,prepared_row.source_draft_revision) returning * into sent_row;
    insert into public.total_loss_communications(case_id,negotiation_round_id,direction,channel,communication_type,status,sender,recipient,subject,
      original_content,occurred_at,recorded_by_user_id,message_version_id)
    values(requested_case_id,draft_row.negotiation_round_id,'outbound','email','follow_up_reconsideration_request','draft',
      (select email from public.total_loss_case_contacts where case_id=requested_case_id),sent_row.recipient,sent_row.subject,sent_row.body,
      sent_row.sent_at,(select auth.uid()),sent_row.id) returning * into communication_row;
    insert into public.total_loss_communication_documents(case_id,communication_id,document_id,display_order)
      select requested_case_id,communication_row.id,document_id,0 from public.total_loss_report_versions where id=draft_row.report_version_id;
    update public.total_loss_communications set status='confirmed',confirmed_at=statement_timestamp() where id=communication_row.id returning * into communication_row;
    update public.total_loss_negotiation_rounds set status='waiting_for_insurer',revision=revision+1 where id=draft_row.negotiation_round_id;
    update public.total_loss_claim_workflows set current_task='awaiting_insurer_response',revision=revision+1
      where case_id=requested_case_id returning * into workflow_row;
    insert into public.total_loss_workflow_events(case_id,event_type,actor_type,actor_user_id,associated_entity_type,associated_entity_id,client_request_id,details)
      values(requested_case_id,'follow_up.customer_reported_sent','customer',(select auth.uid()),'total_loss_communication',communication_row.id,
        requested_client_request_id,jsonb_build_object('decisionId',source_row.decision_id,'responseId',source_row.response_communication_id,
          'analysisResultId',source_row.analysis_result_id,'messageVersionId',sent_row.id,'preparedMessageVersionId',prepared_row.id,
          'reportVersionId',draft_row.report_version_id,'reportAttachedConfirmed',true));
  end if;
  return jsonb_build_object('state','awaiting_insurer_response','messageVersionId',sent_row.id,'communicationId',communication_row.id,
    'negotiationRoundId',communication_row.negotiation_round_id,'customerReportedSentAt',sent_row.sent_at,'workflowRevision',workflow_row.revision);
end;
$$;
revoke execute on function public.confirm_total_loss_customer_follow_up_sent(uuid,uuid,uuid,bigint,boolean) from public,anon,service_role;
grant execute on function public.confirm_total_loss_customer_follow_up_sent(uuid,uuid,uuid,bigint,boolean) to authenticated;

alter type public.total_loss_case_claim_resume_result add attribute follow_up jsonb;
alter function public.resolve_total_loss_case_claim(uuid) rename to resolve_total_loss_case_claim_before_follow_up;
revoke execute on function public.resolve_total_loss_case_claim_before_follow_up(uuid) from public,anon,authenticated,service_role;
create function public.resolve_total_loss_case_claim(requested_case_id uuid)
returns setof public.total_loss_case_claim_resume_result language plpgsql stable security definer set search_path='' as $$
declare result_row public.total_loss_case_claim_resume_result; projection jsonb;
begin
  select * into result_row from public.resolve_total_loss_case_claim_before_follow_up($1);
  if not found then return; end if;
  if result_row.state='secured' and result_row.next_task in ('insurer_response_reviewed','awaiting_insurer_response')
    and result_row.customer_journey ->> 'nextState' in ('insurer_response_reviewed','awaiting_insurer_response') then
    projection:=public.get_total_loss_customer_follow_up($1);
    result_row.follow_up:=projection;
    if projection is not null then
      result_row.insurer_response:=public.total_loss_current_insurer_response_projection_internal($1);
      if projection ->> 'state'<>'sent' and result_row.next_task='insurer_response_reviewed' then
        result_row.workflow_current_task:='follow_up_preparation';result_row.next_task:='follow_up_preparation';
        result_row.customer_journey:=jsonb_build_object('nextState','follow_up_preparation','fulfillmentState','follow_up_preparation','retryable',false);
      end if;
    end if;
  end if;
  return next result_row;
end;
$$;
revoke execute on function public.resolve_total_loss_case_claim(uuid) from public,anon,service_role;
grant execute on function public.resolve_total_loss_case_claim(uuid) to authenticated;

-- No later response or correction may enter the first-response pipeline once
-- the new outbound artifact has been confirmed.
create function public.reject_total_loss_response_after_follow_up()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.direction='inbound' and new.communication_type='insurer_response'
    and exists(select 1 from public.total_loss_communications where case_id=new.case_id
      and direction='outbound' and communication_type='follow_up_reconsideration_request' and status='confirmed') then
    raise exception using errcode='55000',message='The next insurer response is not available in this case stage.'; end if;
  return new;
end;
$$;
revoke execute on function public.reject_total_loss_response_after_follow_up() from public,anon,authenticated,service_role;
create trigger total_loss_response_after_follow_up_guard before insert on public.total_loss_communications
  for each row execute function public.reject_total_loss_response_after_follow_up();


-- Preserve decision replay after the resolver exposes the follow-up step.
create or replace function public.record_total_loss_insurer_response_decision(
  requested_case_id uuid,requested_client_request_id uuid,requested_response_id uuid,
  requested_recommendation_id uuid,requested_choice text,requested_offer_id uuid,
  expected_workflow_revision bigint
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  user_id uuid := (select auth.uid());
  workflow_row public.total_loss_claim_workflows%rowtype;
  recommendation_row public.total_loss_recommendations%rowtype;
  result_row public.total_loss_insurer_response_analysis_results%rowtype;
  decision_row public.total_loss_insurer_response_decisions%rowtype;
  offer_row public.total_loss_offers%rowtype;
  event_row public.total_loss_workflow_events%rowtype;
  resume_row public.total_loss_case_claim_resume_result;
  request_digest text;
begin
  if user_id is null or requested_case_id is null or requested_client_request_id is null
    or requested_response_id is null or requested_recommendation_id is null
    or expected_workflow_revision is null or expected_workflow_revision < 1
    or requested_choice is null or requested_choice not in ('ACCEPT_OFFER','CONTINUE_CHALLENGING')
    or (requested_choice='ACCEPT_OFFER' and requested_offer_id is null)
    or (requested_choice='CONTINUE_CHALLENGING' and requested_offer_id is not null)
  then raise exception using errcode='22023',message='Response decision identity is invalid.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_insurer_response'),pg_catalog.hashtext(requested_case_id::text));
  if not public.is_permanent_total_loss_case_owner(requested_case_id) then
    raise exception using errcode='42501',message='Response decision is unavailable.'; end if;
  select * into workflow_row from public.total_loss_claim_workflows where case_id=requested_case_id for update;
  if workflow_row.current_report_version_id is null
    or not public.total_loss_customer_report_access_internal(requested_case_id,workflow_row.current_report_version_id)
  then raise exception using errcode='42501',message='Response decision is unavailable.'; end if;
  request_digest := public.total_loss_canonical_jsonb_digest(jsonb_build_object(
    'responseId',requested_response_id,'recommendationId',requested_recommendation_id,
    'choice',requested_choice,'offerId',requested_offer_id));
  select * into resume_row from public.resolve_total_loss_case_claim_before_follow_up(requested_case_id);
  select * into event_row from public.total_loss_workflow_events
    where case_id=requested_case_id and client_request_id=requested_client_request_id;
  if found then
    if event_row.event_type <> 'insurer_response.decision_recorded'
      or event_row.details ->> 'requestDigest' is distinct from request_digest
    then raise exception using errcode='55000',message='Client request identity was already used.'; end if;
    select * into decision_row from public.total_loss_insurer_response_decisions
      where id=event_row.associated_entity_id and case_id=requested_case_id;
    if decision_row.id is null then raise exception using errcode='55000',message='Recorded response decision is unavailable.'; end if;
    if workflow_row.current_recommendation_id is distinct from requested_recommendation_id
      or expected_workflow_revision > workflow_row.revision
      or resume_row.state is distinct from 'secured'
      or resume_row.next_task is distinct from 'insurer_response_reviewed'
      or resume_row.customer_journey ->> 'nextState' is distinct from 'insurer_response_reviewed'
    then
      raise exception using errcode='40001',message='Claim workflow changed before the response decision.';
    end if;
    return jsonb_build_object('state','insurer_response_reviewed','response',
      public.total_loss_insurer_response_projection_internal(requested_case_id,requested_response_id),
      'workflowRevision',workflow_row.revision);
  end if;
  if workflow_row.revision <> expected_workflow_revision
    or resume_row.state is distinct from 'secured'
    or resume_row.next_task is distinct from 'insurer_response_reviewed'
    or resume_row.customer_journey ->> 'nextState' is distinct from 'insurer_response_reviewed'
    or workflow_row.current_recommendation_id is distinct from requested_recommendation_id
  then raise exception using errcode='40001',message='Claim workflow changed before the response decision.'; end if;
  select * into recommendation_row from public.total_loss_recommendations
    where id=requested_recommendation_id and case_id=requested_case_id and status='published';
  select * into result_row from public.total_loss_insurer_response_analysis_results
    where id=recommendation_row.source_analysis_result_id and case_id=requested_case_id;
  if result_row.id is null or result_row.response_communication_id <> requested_response_id
    or result_row.job_id <> workflow_row.current_response_analysis_job_id
    or exists(select 1 from public.total_loss_communications where supersedes_communication_id=requested_response_id
      and case_id=requested_case_id and status='confirmed')
  then raise exception using errcode='40001',message='The analyzed response changed before the decision.'; end if;
  if exists(select 1 from public.total_loss_insurer_response_decisions where recommendation_id=recommendation_row.id) then
    raise exception using errcode='55000',message='A decision is already recorded for this analyzed response.'; end if;
  if requested_choice='ACCEPT_OFFER' then
    select * into offer_row from public.total_loss_offers
      where id=requested_offer_id and case_id=requested_case_id and status='recorded';
    if offer_row.id is null or recommendation_row.source_offer_id is distinct from offer_row.id
      or workflow_row.current_offer_id is distinct from offer_row.id
      or offer_row.source_communication_id <> requested_response_id
    then raise exception using errcode='22023',message='The selected offer does not match this analyzed response.'; end if;
  end if;
  update public.total_loss_claim_workflows as workflow set revision=workflow.revision+1
    where case_id=requested_case_id returning * into workflow_row;
  insert into public.total_loss_insurer_response_decisions (
    case_id,response_communication_id,analysis_result_id,recommendation_id,client_request_id,choice,
    offer_id,offer_amount_minor_units,offer_currency,recorded_by_user_id,workflow_revision,request_digest
  ) values (requested_case_id,requested_response_id,result_row.id,recommendation_row.id,requested_client_request_id,
    requested_choice,offer_row.id,offer_row.amount_minor_units,offer_row.currency,user_id,workflow_row.revision,request_digest)
    returning * into decision_row;
  insert into public.total_loss_workflow_events (
    case_id,event_type,actor_type,actor_user_id,associated_entity_type,associated_entity_id,client_request_id,details
  ) values (requested_case_id,'insurer_response.decision_recorded','customer',user_id,
    'total_loss_insurer_response_decision',decision_row.id,requested_client_request_id,
    jsonb_build_object('requestDigest',request_digest,'responseId',requested_response_id,
      'recommendationId',recommendation_row.id,'analysisResultId',result_row.id,
      'choice',requested_choice,'offerId',offer_row.id,'workflowRevision',workflow_row.revision));
  return jsonb_build_object('state','insurer_response_reviewed','response',
    public.total_loss_insurer_response_projection_internal(requested_case_id,requested_response_id),
    'workflowRevision',workflow_row.revision);
end;
$$;

create function public.reject_total_loss_response_upload_after_follow_up()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.document_kind='insurer_response' and new.status='pending'
    and exists(select 1 from public.total_loss_communications where case_id=new.case_id
      and communication_type='follow_up_reconsideration_request' and status='confirmed') then
    raise exception using errcode='55000',message='The next insurer response is not available in this case stage.'; end if;
  return new;
end;
$$;
revoke execute on function public.reject_total_loss_response_upload_after_follow_up() from public,anon,authenticated,service_role;
create trigger total_loss_response_upload_after_follow_up_guard before insert on public.total_loss_claim_documents
  for each row execute function public.reject_total_loss_response_upload_after_follow_up();

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
      and not exists(select 1 from public.total_loss_communications where case_id=document.case_id
        and communication_type='follow_up_reconsideration_request' and status='confirmed')
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

-- A customer may still correct the first response while its follow-up is a draft.
-- The correction invalidates current recommendation lineage before another draft
-- can be generated. Sent follow-ups are fenced by the guards above.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.record_total_loss_insurer_response(uuid,uuid,text,bigint,uuid,uuid,uuid,bigint)'::regprocedure) into definition;
  if position('round_row.status <> ''response_received''' in definition)=0 then
    raise exception 'The first-response correction contract changed.';
  end if;
  execute replace(definition,'round_row.status <> ''response_received''',
    'round_row.status not in (''response_received'', ''preparing_follow_up'')');
end;
$$;

notify pgrst,'reload schema';
