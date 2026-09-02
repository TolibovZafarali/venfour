-- Customer confirmation completes the existing workflow resolution lifecycle.
-- The immutable event retains the exact request and accepted evidence identity.
alter table public.total_loss_claim_workflows
  add column resolution_details jsonb,
  add constraint total_loss_claim_workflows_customer_resolution_valid check (
    (case when resolution_code in ('ACCEPTED_VERIFIED_OFFER','RESOLVED_WITH_INSURER','CUSTOMER_STOPPED_PURSUING') then
      phase='resolution' and current_task='resolved'
      and jsonb_typeof(resolution_details)='object'
      and resolution_details ->> 'customerConfirmed'='true'
      and resolution_details ->> 'resolutionCode'=resolution_code
      and (resolution_details ->> 'resolvedAt')::timestamptz=resolved_at
      and resolution_details ->> 'clientRequestId' is not null
      and resolution_details ->> 'requestDigest' ~ '^[0-9a-f]{64}$'
      and resolution_details ->> 'confirmedByUserId' is not null
      and (case when resolution_code='ACCEPTED_VERIFIED_OFFER' then
        resolution_details ->> 'offerId' is not null
        and resolution_details ->> 'decisionId' is not null
        and resolution_details ->> 'recommendationId' is not null
        and resolution_details ->> 'responseId' is not null
        and resolution_details ->> 'amountSource'='VERIFIED_INSURER_OFFER'
        and (resolution_details ->> 'amountMinorUnits')::bigint > 0
        and resolution_details ->> 'currency' ~ '^[A-Z]{3}$'
      when resolution_code='RESOLVED_WITH_INSURER' then
        resolution_details ->> 'offerId' is null
        and resolution_details ->> 'decisionId' is null
        and resolution_details ->> 'recommendationId' is null
        and resolution_details ->> 'responseId' is null
        and ((resolution_details ->> 'amountMinorUnits' is null
          and resolution_details ->> 'currency' is null and resolution_details ->> 'amountSource' is null)
          or ((resolution_details ->> 'amountMinorUnits')::bigint > 0
            and resolution_details ->> 'currency' ~ '^[A-Z]{3}$'
            and resolution_details ->> 'amountSource'='CUSTOMER_REPORTED'))
      else
        resolution_details ->> 'offerId' is null and resolution_details ->> 'decisionId' is null
        and resolution_details ->> 'recommendationId' is null and resolution_details ->> 'responseId' is null
        and resolution_details ->> 'amountMinorUnits' is null and resolution_details ->> 'currency' is null
        and resolution_details ->> 'amountSource' is null
      end)
    else resolution_details is null end) is true
  );

create function public.total_loss_case_resolution_projection_internal(requested_case_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('code',workflow.resolution_code,'resolvedAt',workflow.resolved_at,
    'customerConfirmed',coalesce((workflow.resolution_details ->> 'customerConfirmed')::boolean,false),
    'clientRequestId',workflow.resolution_details -> 'clientRequestId',
    'offerId',workflow.resolution_details -> 'offerId',
    'amountMinorUnits',workflow.resolution_details -> 'amountMinorUnits',
    'currency',workflow.resolution_details -> 'currency',
    'amountSource',workflow.resolution_details -> 'amountSource',
    'recommendationId',workflow.resolution_details -> 'recommendationId',
    'decisionId',workflow.resolution_details -> 'decisionId',
    'responseId',workflow.resolution_details -> 'responseId')
  from public.total_loss_claim_workflows workflow
  where workflow.case_id=$1 and workflow.resolution_code is not null and workflow.resolved_at is not null;
$$;
revoke execute on function public.total_loss_case_resolution_projection_internal(uuid) from public,anon,authenticated,service_role;

create function public.confirm_total_loss_case_resolution(
  requested_case_id uuid,requested_client_request_id uuid,requested_resolution_code text,
  expected_workflow_revision bigint,requested_decision_id uuid default null,requested_offer_id uuid default null,
  requested_amount_minor_units bigint default null,requested_currency text default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  workflow_row public.total_loss_claim_workflows%rowtype;
  event_row public.total_loss_workflow_events%rowtype;
  decision_row public.total_loss_insurer_response_decisions%rowtype;
  recommendation_row public.total_loss_recommendations%rowtype;
  result_row public.total_loss_insurer_response_analysis_results%rowtype;
  offer_row public.total_loss_offers%rowtype;
  resume_row public.total_loss_case_claim_resume_result;
  user_id uuid:=(select auth.uid()); request_digest text; details jsonb; completed_at timestamptz;
begin
  if user_id is null or requested_case_id is null or requested_client_request_id is null
    or expected_workflow_revision is null or expected_workflow_revision < 1
    or requested_resolution_code is null
    or requested_resolution_code not in ('ACCEPTED_VERIFIED_OFFER','RESOLVED_WITH_INSURER','CUSTOMER_STOPPED_PURSUING')
    or (requested_resolution_code='ACCEPTED_VERIFIED_OFFER' and
      (requested_decision_id is null or requested_offer_id is null
        or requested_amount_minor_units is not null or requested_currency is not null))
    or (requested_resolution_code<>'ACCEPTED_VERIFIED_OFFER' and
      (requested_decision_id is not null or requested_offer_id is not null))
    or (requested_resolution_code='CUSTOMER_STOPPED_PURSUING' and
      (requested_amount_minor_units is not null or requested_currency is not null))
    or ((requested_amount_minor_units is null)<>(requested_currency is null))
    or (requested_amount_minor_units is not null and
      (requested_amount_minor_units not between 1 and 9007199254740991 or requested_currency !~ '^[A-Z]{3}$'))
  then raise exception using errcode='22023',message='Case resolution confirmation is invalid.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_insurer_response'),pg_catalog.hashtext($1::text));
  if not public.is_permanent_total_loss_case_owner($1) then
    raise exception using errcode='42501',message='Case resolution is unavailable.'; end if;
  select * into workflow_row from public.total_loss_claim_workflows where case_id=$1 for update;
  if workflow_row.current_report_version_id is null
    or not public.total_loss_customer_report_access_internal($1,workflow_row.current_report_version_id) then
    raise exception using errcode='42501',message='Case resolution is unavailable.'; end if;
  select * into resume_row from public.resolve_total_loss_case_claim($1);
  if resume_row.state is distinct from 'secured' then
    raise exception using errcode='42501',message='Case resolution is unavailable.'; end if;
  request_digest:=public.total_loss_canonical_jsonb_digest(jsonb_build_object(
    'resolutionCode',$3,'workflowRevision',$4,'decisionId',$5,'offerId',$6,'amountMinorUnits',$7,'currency',$8));
  select * into event_row from public.total_loss_workflow_events where case_id=$1 and client_request_id=$2;
  if found then
    if event_row.event_type<>'case.customer_resolution_confirmed'
      or event_row.details ->> 'requestDigest' is distinct from request_digest
      or workflow_row.resolution_details ->> 'clientRequestId' is distinct from $2::text
      or workflow_row.resolution_details is distinct from event_row.details then
      raise exception using errcode='55000',message='Client request identity was already used.'; end if;
    return jsonb_build_object('state','resolved','resolution',public.total_loss_case_resolution_projection_internal($1),
      'workflowRevision',workflow_row.revision);
  end if;
  if workflow_row.resolution_code is not null or workflow_row.resolved_at is not null
    or workflow_row.revision<>expected_workflow_revision
    or workflow_row.phase<>'negotiation'
    or workflow_row.current_task not in ('awaiting_insurer_response','insurer_response_received')
    or not exists(select 1 from public.total_loss_negotiation_rounds where id=workflow_row.current_negotiation_round_id
      and case_id=$1 and status<>'closed') then
    raise exception using errcode='40001',message='Claim workflow changed before case resolution.'; end if;
  -- Work still pending publication must finish before the customer can close.
  -- Workers and customer mutations serialize against the workflow row lock.
  if exists(select 1 from public.total_loss_insurer_response_analysis_jobs where case_id=$1
      and status in ('pending','processing','retryable_failed'))
    or (workflow_row.current_response_analysis_job_id is not null and exists(
      select 1 from public.total_loss_insurer_response_analysis_jobs job
      where job.id=workflow_row.current_response_analysis_job_id and job.status='completed'
        and not exists(select 1 from public.total_loss_recommendations recommendation
          where recommendation.source_analysis_result_id in
            (select id from public.total_loss_insurer_response_analysis_results where job_id=job.id)))) then
    raise exception using errcode='55000',message='Wait for the current insurer response review before closing this case.'; end if;
  if requested_resolution_code='ACCEPTED_VERIFIED_OFFER' then
    select * into decision_row from public.total_loss_insurer_response_decisions where id=$5 and case_id=$1;
    select * into recommendation_row from public.total_loss_recommendations
      where id=workflow_row.current_recommendation_id and case_id=$1 and status='published';
    select * into result_row from public.total_loss_insurer_response_analysis_results
      where id=recommendation_row.source_analysis_result_id and case_id=$1;
    select * into offer_row from public.total_loss_offers where id=$6 and case_id=$1 and status='recorded';
    if decision_row.id is null or decision_row.choice<>'ACCEPT_OFFER'
      or workflow_row.current_task<>'insurer_response_received'
      or decision_row.recommendation_id is distinct from recommendation_row.id
      or decision_row.analysis_result_id is distinct from result_row.id
      or decision_row.response_communication_id is distinct from result_row.response_communication_id
      or result_row.job_id is distinct from workflow_row.current_response_analysis_job_id
      or not exists(select 1 from public.total_loss_insurer_response_analysis_jobs job
        where job.id=result_row.job_id and job.case_id=$1 and job.status='completed'
          and job.negotiation_round_id=workflow_row.current_negotiation_round_id
          and job.source_report_version_id=workflow_row.current_report_version_id)
      or decision_row.offer_id is distinct from offer_row.id
      or recommendation_row.source_offer_id is distinct from offer_row.id
      or workflow_row.current_offer_id is distinct from offer_row.id
      or offer_row.source_communication_id is distinct from decision_row.response_communication_id
      or decision_row.offer_amount_minor_units is distinct from offer_row.amount_minor_units
      or decision_row.offer_currency is distinct from offer_row.currency
      or exists(select 1 from public.total_loss_communications where case_id=$1
        and supersedes_communication_id=decision_row.response_communication_id and status='confirmed') then
      raise exception using errcode='40001',message='The accepted offer or customer decision is no longer current.'; end if;
  end if;
  completed_at:=statement_timestamp();
  details:=jsonb_build_object('resolutionCode',$3,'resolvedAt',completed_at,'customerConfirmed',true,'clientRequestId',$2,'requestDigest',request_digest,
    'confirmedByUserId',user_id,'expectedWorkflowRevision',$4,'workflowRevision',workflow_row.revision+1,
    'offerId',offer_row.id,'amountMinorUnits',coalesce(offer_row.amount_minor_units,$7),
    'currency',coalesce(offer_row.currency,$8),
    'amountSource',case when offer_row.id is not null then 'VERIFIED_INSURER_OFFER'
      when $7 is not null then 'CUSTOMER_REPORTED' else null end,
    'recommendationId',decision_row.recommendation_id,'decisionId',decision_row.id,
    'responseId',decision_row.response_communication_id);
  update public.total_loss_negotiation_rounds set status='closed',closed_at=completed_at,revision=revision+1
    where case_id=$1 and id=workflow_row.current_negotiation_round_id and status<>'closed';
  update public.total_loss_claim_workflows set phase='resolution',current_task='resolved',
    resolution_code=$3,resolved_at=completed_at,resolution_details=details,revision=revision+1
    where case_id=$1 returning * into workflow_row;
  insert into public.total_loss_workflow_events(case_id,event_type,actor_type,actor_user_id,
    associated_entity_type,associated_entity_id,client_request_id,details)
    values($1,'case.customer_resolution_confirmed','customer',user_id,'total_loss_claim_workflow',$1,$2,details);
  return jsonb_build_object('state','resolved','resolution',public.total_loss_case_resolution_projection_internal($1),
    'workflowRevision',workflow_row.revision);
end;
$$;
revoke execute on function public.confirm_total_loss_case_resolution(uuid,uuid,text,bigint,uuid,uuid,bigint,text) from public,anon,service_role;
grant execute on function public.confirm_total_loss_case_resolution(uuid,uuid,text,bigint,uuid,uuid,bigint,text) to authenticated;

-- A terminal workflow is immutable. Financial access remains separately governed.
create function public.protect_total_loss_resolved_workflow()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.resolution_code is not null then
    raise exception using errcode='55000',message='This case is closed and read-only.';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function public.protect_total_loss_resolved_workflow() from public,anon,authenticated,service_role;
create trigger aaa_total_loss_resolved_workflow before update or delete on public.total_loss_claim_workflows
  for each row execute function public.protect_total_loss_resolved_workflow();

-- Defense in depth also fences direct trusted writes and a generation finishing
-- after its customer source has closed. Row locking serializes closure races.
create function public.protect_total_loss_resolved_case_records()
returns trigger language plpgsql security definer set search_path='' as $$
declare source_case_id uuid; resolution text;
begin
  source_case_id:=case when tg_op='DELETE' then old.case_id else new.case_id end;
  select resolution_code into resolution from public.total_loss_claim_workflows where case_id=source_case_id for update;
  if resolution is not null then raise exception using errcode='55000',message='This case is closed and read-only.'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function public.protect_total_loss_resolved_case_records() from public,anon,authenticated,service_role;
do $$
declare table_name text;
begin
  foreach table_name in array array['total_loss_message_drafts','total_loss_message_versions',
    'total_loss_communications','total_loss_communication_documents','total_loss_offers','total_loss_recommendations',
    'total_loss_insurer_response_decisions','total_loss_negotiation_rounds','total_loss_follow_up_sources',
    'total_loss_follow_up_generation_blocks','total_loss_claim_documents','total_loss_education_progress',
    'total_loss_sending_details','total_loss_insurer_response_upload_sources',
    'total_loss_insurer_response_analysis_jobs','total_loss_insurer_response_analysis_runs',
    'total_loss_insurer_response_analysis_results','total_loss_insurer_response_document_extractions']
  loop
    execute format('create trigger aaa_total_loss_closed_record before insert or update or delete on public.%I for each row execute function public.protect_total_loss_resolved_case_records()',table_name);
  end loop;
end;
$$;

alter type public.total_loss_case_claim_resume_result add attribute case_resolution jsonb;
alter function public.resolve_total_loss_case_claim(uuid) rename to resolve_total_loss_case_claim_before_resolution;
revoke execute on function public.resolve_total_loss_case_claim_before_resolution(uuid) from public,anon,authenticated,service_role;
create function public.resolve_total_loss_case_claim(requested_case_id uuid)
returns setof public.total_loss_case_claim_resume_result language plpgsql stable security definer set search_path='' as $$
declare result_row public.total_loss_case_claim_resume_result; workflow_row public.total_loss_claim_workflows%rowtype;
begin
  select * into result_row from public.resolve_total_loss_case_claim_before_resolution($1);
  if not found then return; end if;
  select * into workflow_row from public.total_loss_claim_workflows where case_id=$1;
  if result_row.state='secured' and workflow_row.resolution_code is not null
    and public.total_loss_customer_report_access_internal($1,workflow_row.current_report_version_id) then
    result_row.case_resolution:=public.total_loss_case_resolution_projection_internal($1);
    if workflow_row.resolution_code in ('ACCEPTED_VERIFIED_OFFER','RESOLVED_WITH_INSURER','CUSTOMER_STOPPED_PURSUING') then
      result_row.workflow_current_task:='resolved'; result_row.next_task:='resolved';
      result_row.customer_journey:=jsonb_build_object('nextState','resolved','fulfillmentState','resolved','retryable',false);
      result_row.response_intake:=null;
      result_row.insurer_response:=public.total_loss_current_insurer_response_projection_internal($1);
      result_row.negotiation_history:=public.total_loss_negotiation_history_projection_internal($1);
      result_row.follow_up:=public.total_loss_follow_up_projection_internal($1);
    end if;
  end if;
  return next result_row;
end;
$$;
revoke execute on function public.resolve_total_loss_case_claim(uuid) from public,anon,service_role;
grant execute on function public.resolve_total_loss_case_claim(uuid) to authenticated;
-- Existing mutation retries must not present an active result after closure.
create function public.assert_total_loss_customer_case_open_internal(requested_case_id uuid)
returns void language plpgsql volatile security definer set search_path='' as $$
declare workflow_row public.total_loss_claim_workflows%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_insurer_response'),pg_catalog.hashtext($1::text));
  select * into workflow_row from public.total_loss_claim_workflows where case_id=$1 for update;
  if workflow_row.resolution_code is not null
    and public.total_loss_customer_report_access_internal($1,workflow_row.current_report_version_id) then
    raise exception using errcode='55000',message='This case is closed and read-only.'; end if;
end;
$$;
revoke execute on function public.assert_total_loss_customer_case_open_internal(uuid) from public,anon,authenticated,service_role;
do $$
declare function_row record; definition text;
begin
  for function_row in select procedure.oid from pg_proc procedure
    join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public' and procedure.proname in (
      'record_total_loss_insurer_response','prepare_total_loss_insurer_response_upload',
      'retry_total_loss_insurer_response_analysis','record_total_loss_insurer_response_decision',
      'put_total_loss_education_progress','put_total_loss_sending_details',
      'prepare_total_loss_customer_message','patch_total_loss_customer_message_draft',
      'record_total_loss_customer_email_opened','confirm_total_loss_customer_message_sent',
      'patch_total_loss_customer_follow_up_draft','prepare_total_loss_customer_follow_up',
      'confirm_total_loss_customer_follow_up_sent')
  loop
    definition:=pg_get_functiondef(function_row.oid);
    if position(E'\nbegin\n' in definition)=0 then raise exception 'The customer mutation entry contract changed.'; end if;
    execute replace(definition,E'\nbegin\n',E'\nbegin\n  perform public.assert_total_loss_customer_case_open_internal(requested_case_id);\n');
  end loop;
end;
$$;

-- The coarse owned list recognizes terminal workflows without changing the
-- original analysis status needed by historical report eligibility checks.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.list_owned_case_operations()'::regprocedure) into definition;
  if position('operation.case_status,' in definition)=0 or position('operation.case_stage,' in definition)=0 then
    raise exception 'The owned case projection contract changed.'; end if;
  definition:=replace(definition,'operation.case_status,',
    'case when workflow.resolved_at is not null then ''closed''::public.appraisal_case_status else operation.case_status end,');
  definition:=replace(definition,'operation.case_stage,',
    'case when workflow.resolved_at is not null then ''closed''::public.case_operation_stage else operation.case_stage end,');
  execute definition;
end;
$$;
notify pgrst,'reload schema';
