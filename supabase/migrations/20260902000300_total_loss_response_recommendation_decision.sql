-- Persist the valuation recommendation and the customer's separate explicit
-- choice without closing the case or advancing another response round.

alter table public.total_loss_recommendations
  add column source_analysis_result_id uuid,
  add column source_report_version_id uuid,
  add column source_final_assessment_id uuid,
  add column source_offer_id uuid,
  add column source_analysis_result_digest text,
  add column source_evidence_index_digest text,
  add column source_report_digest text,
  add column source_assessment_digest text,
  add constraint total_loss_recommendations_response_result_key unique (source_analysis_result_id),
  add constraint total_loss_recommendations_response_result_fkey
    foreign key (source_analysis_result_id, case_id)
    references public.total_loss_insurer_response_analysis_results (id, case_id),
  add constraint total_loss_recommendations_source_report_fkey
    foreign key (source_report_version_id, case_id)
    references public.total_loss_report_versions (id, case_id),
  add constraint total_loss_recommendations_source_assessment_fkey
    foreign key (source_final_assessment_id, case_id)
    references public.total_loss_final_assessments (id, case_id),
  add constraint total_loss_recommendations_source_offer_fkey
    foreign key (source_offer_id, case_id)
    references public.total_loss_offers (id, case_id),
  add constraint total_loss_recommendations_response_source_complete check (
    source_analysis_result_id is null or (
      source_report_version_id is not null
      and source_final_assessment_id is not null
      and source_analysis_result_digest is not null
      and source_evidence_index_digest is not null
      and source_report_digest is not null
      and source_assessment_digest is not null
      and source_analysis_result_digest ~ '^[0-9a-f]{64}$'
      and source_evidence_index_digest ~ '^[0-9a-f]{64}$'
      and source_report_digest ~ '^[0-9a-f]{64}$'
      and source_assessment_digest ~ '^[0-9a-f]{64}$'
      and generation_method = 'deterministic'
      and recommendation_type = 'insurer_response_valuation'
      and status = 'published'
    )
  );

create table public.total_loss_insurer_response_decisions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete restrict,
  response_communication_id uuid not null,
  analysis_result_id uuid not null,
  recommendation_id uuid not null,
  client_request_id uuid not null,
  choice text not null,
  offer_id uuid,
  offer_amount_minor_units bigint,
  offer_currency text,
  recorded_by_user_id uuid not null references auth.users (id) on delete restrict,
  workflow_revision bigint not null,
  request_digest text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint total_loss_response_decisions_recommendation_key unique (recommendation_id),
  constraint total_loss_response_decisions_request_key unique (case_id, client_request_id),
  constraint total_loss_response_decisions_response_fkey foreign key (response_communication_id, case_id)
    references public.total_loss_communications (id, case_id),
  constraint total_loss_response_decisions_result_fkey foreign key (analysis_result_id, case_id)
    references public.total_loss_insurer_response_analysis_results (id, case_id),
  constraint total_loss_response_decisions_recommendation_fkey foreign key (recommendation_id, case_id)
    references public.total_loss_recommendations (id, case_id),
  constraint total_loss_response_decisions_offer_fkey foreign key (offer_id, case_id)
    references public.total_loss_offers (id, case_id),
  constraint total_loss_response_decisions_choice_valid check (
    (choice = 'CONTINUE_CHALLENGING' and offer_id is null
      and offer_amount_minor_units is null and offer_currency is null)
    or (choice = 'ACCEPT_OFFER' and offer_id is not null
      and offer_amount_minor_units > 0 and offer_currency ~ '^[A-Z]{3}$')
  ),
  constraint total_loss_response_decisions_audit_valid check (
    workflow_revision > 0 and request_digest ~ '^[0-9a-f]{64}$'
  )
);

comment on table public.total_loss_insurer_response_decisions is
  'One immutable explicit customer choice per exact analyzed-response recommendation; accepting snapshots one immutable offer and does not close the case.';

create trigger total_loss_response_decisions_reject_mutation
before update or delete on public.total_loss_insurer_response_decisions
for each row execute function public.reject_total_loss_immutable_record();
alter table public.total_loss_insurer_response_decisions enable row level security;
revoke all on public.total_loss_insurer_response_decisions from public, anon, authenticated, service_role;

create function public.total_loss_response_recommendation_is_valid(value jsonb)
returns boolean
language sql immutable parallel safe set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(value) = 'object' and pg_column_size(value) <= 262144
    and value ?& array['schemaVersion','policyVersion','state','summary','reasons',
      'reasonCodes','limitations','responseEvidenceRefs','caseEvidenceRefs','offer','policyInput']
    and (select count(*) = 11 from jsonb_object_keys(value))
    and value ->> 'schemaVersion' = '1'
    and value ->> 'policyVersion' = '1'
    and value ->> 'state' in ('ACCEPT_OFFER','CONTINUE_CHALLENGING','NO_CLEAR_RECOMMENDATION')
    and jsonb_typeof(value -> 'summary') = 'string'
    and char_length(value ->> 'summary') between 1 and 2000
    and jsonb_typeof(value -> 'policyInput') = 'object'
    and not exists (
      select 1 from (values ('reasons'),('reasonCodes'),('limitations'),
        ('responseEvidenceRefs'),('caseEvidenceRefs')) as field(name)
      where jsonb_typeof(value -> field.name) is distinct from 'array'
        or (field.name in ('reasons','reasonCodes','limitations') and jsonb_array_length(value -> field.name) < 1)
        or jsonb_array_length(value -> field.name) >
          case when field.name in ('responseEvidenceRefs','caseEvidenceRefs') then 250 else 10 end
        or exists (
          select 1 from jsonb_array_elements(value -> field.name) as item(entry)
          where jsonb_typeof(item.entry) <> 'string'
            or char_length(item.entry #>> '{}') not between 1 and 2000
            or (field.name = 'reasonCodes' and item.entry #>> '{}' !~ '^[A-Z][A-Z0-9_]{0,63}$')
        )
        or (select count(*) <> count(distinct item.entry)
          from jsonb_array_elements(value -> field.name) as item(entry))
    )
    and (value -> 'offer' = 'null'::jsonb or (
      jsonb_typeof(value -> 'offer') = 'object'
      and value -> 'offer' ?& array['amountMinorUnits','currency','source']
      and (select count(*) = 3 from jsonb_object_keys(value -> 'offer'))
      and jsonb_typeof(value #> '{offer,amountMinorUnits}') = 'number'
      and value #>> '{offer,amountMinorUnits}' ~ '^[1-9][0-9]*$'
      and (value #>> '{offer,amountMinorUnits}')::numeric <= 1000000000000
      and value #>> '{offer,currency}' ~ '^[A-Z]{3}$'
      and value #>> '{offer,source}' in ('CUSTOMER_RECORDED','RESPONSE_TEXT')
    )), false);
$$;

revoke execute on function public.total_loss_response_recommendation_is_valid(jsonb)
  from public, anon, authenticated, service_role;

alter table public.total_loss_recommendations
  add constraint total_loss_recommendations_response_payload_valid check (
    source_analysis_result_id is null or (
      public.total_loss_response_recommendation_is_valid(recommendation)
      and recommendation_digest=public.total_loss_canonical_jsonb_digest(recommendation)
    )
  );

create function public.resolve_total_loss_response_recommendation_processing_context(
  requested_job_id uuid, requested_processing_token uuid
)
returns table (
  job_id uuid, run_id uuid, case_id uuid, analysis_context jsonb,
  response_document_id uuid, response_document_bucket text,
  response_document_object_name text, response_document_media_type text,
  response_document_byte_size bigint, response_document_content_digest text,
  existing_extraction_version text, existing_extraction jsonb, existing_extraction_digest text,
  final_assessment jsonb, assessment_digest text, customer_offer jsonb
)
language sql stable security definer set search_path = ''
as $$
  select context.*, assessment.assessment, assessment.assessment_digest,
    case when offer.id is null then null else jsonb_build_object(
      'offerId', offer.id, 'amountMinorUnits', offer.amount_minor_units,
      'currency', offer.currency, 'sourceCommunicationId', offer.source_communication_id
    ) end
  from public.resolve_total_loss_insurer_response_analysis_context($1,$2) as context
  join public.total_loss_insurer_response_analysis_jobs as job on job.id = context.job_id
  join public.total_loss_report_versions as report on report.id = job.source_report_version_id
    and report.case_id = job.case_id
  join public.total_loss_final_assessments as assessment on assessment.id = report.final_assessment_id
    and assessment.case_id = report.case_id
  left join public.total_loss_offers as offer on offer.source_communication_id = job.response_communication_id
    and offer.case_id = job.case_id and offer.status = 'recorded';
$$;

create function public.resolve_current_total_loss_response_recommendation_context(requested_case_id uuid)
returns table (
  analysis_result_id uuid, response_id uuid, analysis_result jsonb, evidence_index jsonb,
  final_assessment jsonb, assessment_digest text, customer_offer jsonb, recommendation_id uuid
)
language sql stable security definer set search_path = ''
as $$
  select result.id, result.response_communication_id, result.result, result.evidence_index,
    assessment.assessment, assessment.assessment_digest,
    case when offer.id is null or recommendation.source_offer_id = offer.id
      and recommendation.recommendation #>> '{offer,source}' = 'RESPONSE_TEXT'
      then null else jsonb_build_object(
        'offerId', offer.id, 'amountMinorUnits', offer.amount_minor_units,
        'currency', offer.currency, 'sourceCommunicationId', offer.source_communication_id
      ) end,
    recommendation.id
  from public.total_loss_claim_workflows as workflow
  join public.total_loss_insurer_response_analysis_jobs as job
    on job.id = workflow.current_response_analysis_job_id and job.case_id = workflow.case_id
    and job.status = 'completed'
  join public.total_loss_insurer_response_analysis_results as result on result.job_id = job.id
    and result.case_id = job.case_id
  join public.total_loss_report_versions as report on report.id = job.source_report_version_id
    and report.case_id = job.case_id and report.status = 'published'
  join public.total_loss_final_assessments as assessment on assessment.id = report.final_assessment_id
    and assessment.case_id = report.case_id
  left join public.total_loss_recommendations as recommendation
    on recommendation.source_analysis_result_id = result.id
  left join public.total_loss_offers as offer on offer.source_communication_id = job.response_communication_id
    and offer.case_id = job.case_id and offer.status = 'recorded'
  where workflow.case_id = $1 and not exists (
    select 1 from public.total_loss_communications as successor
    where successor.supersedes_communication_id = job.response_communication_id
      and successor.case_id = job.case_id and successor.status = 'confirmed'
  );
$$;

create function public.publish_total_loss_insurer_response_recommendation(
  requested_analysis_result_id uuid, requested_recommendation jsonb,
  requested_recommendation_digest text
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  result_row public.total_loss_insurer_response_analysis_results%rowtype;
  job_row public.total_loss_insurer_response_analysis_jobs%rowtype;
  report_row public.total_loss_report_versions%rowtype;
  assessment_row public.total_loss_final_assessments%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  recommendation_row public.total_loss_recommendations%rowtype;
  offer_row public.total_loss_offers%rowtype;
  previous_recommendation_id uuid;
  previous_offer_id uuid;
  expected_policy_input jsonb;
  effective_offer_id uuid;
  expected_amount bigint;
  offer_count integer;
  literal_offer boolean;
begin
  if requested_analysis_result_id is null
    or public.total_loss_response_recommendation_is_valid(requested_recommendation) is not true
    or requested_recommendation_digest is null
    or requested_recommendation_digest is distinct from
      public.total_loss_canonical_jsonb_digest(requested_recommendation)
  then raise exception using errcode='22023', message='Response recommendation is invalid.'; end if;

  select * into result_row from public.total_loss_insurer_response_analysis_results
    where id = requested_analysis_result_id;
  if not found then raise exception using errcode='55000', message='Response analysis is unavailable.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_insurer_response'),
    pg_catalog.hashtext(result_row.case_id::text));
  select * into workflow_row from public.total_loss_claim_workflows
    where case_id = result_row.case_id for update;
  select * into recommendation_row from public.total_loss_recommendations
    where source_analysis_result_id = result_row.id;
  if found then
    if recommendation_row.recommendation is distinct from requested_recommendation
      or recommendation_row.recommendation_digest is distinct from requested_recommendation_digest
    then raise exception using errcode='55000', message='Response recommendation conflicts with its immutable version.'; end if;
    return jsonb_build_object('outcome','duplicate','recommendationId',recommendation_row.id,
      'workflowRevision',workflow_row.revision);
  end if;

  select * into job_row from public.total_loss_insurer_response_analysis_jobs
    where id = result_row.job_id and case_id = result_row.case_id;
  if job_row.status is distinct from 'completed'
    or workflow_row.current_response_analysis_job_id is distinct from job_row.id
    or workflow_row.current_report_version_id is distinct from job_row.source_report_version_id
    or workflow_row.current_negotiation_round_id is distinct from job_row.negotiation_round_id
    or exists (select 1 from public.total_loss_communications as successor
      where successor.supersedes_communication_id = job_row.response_communication_id
        and successor.case_id = job_row.case_id and successor.status = 'confirmed')
  then return jsonb_build_object('outcome','superseded','recommendationId',null,
    'workflowRevision',workflow_row.revision); end if;

  select * into report_row from public.total_loss_report_versions
    where id = job_row.source_report_version_id and case_id = job_row.case_id and status = 'published';
  select * into assessment_row from public.total_loss_final_assessments
    where id = report_row.final_assessment_id and case_id = report_row.case_id;
  if assessment_row.id is null then raise exception using errcode='55000', message='Saved valuation evidence is unavailable.'; end if;
  expected_policy_input := jsonb_build_object(
    'assessmentDigest',assessment_row.assessment_digest,
    'finalClassification',assessment_row.assessment -> 'finalClassification',
    'evidenceStrength',assessment_row.assessment -> 'evidenceStrength',
    'evidenceBasis',assessment_row.assessment -> 'evidenceBasis',
    'continuationStatus',assessment_row.assessment -> 'continuationStatus',
    'supportedRange',assessment_row.assessment -> 'supportedRange',
    'validationIssues',coalesce(assessment_row.assessment -> 'validationIssues','[]'::jsonb),
    'preliminaryToFinalComparison',assessment_row.assessment -> 'preliminaryToFinalComparison'
  );
  if requested_recommendation -> 'policyInput' is distinct from expected_policy_input
    or public.total_loss_response_analysis_evidence_index_is_valid(
      result_row.evidence_index, requested_recommendation) is not true
  then raise exception using errcode='22023', message='Recommendation evidence does not match its saved sources.'; end if;

  if requested_recommendation -> 'offer' <> 'null'::jsonb then
    expected_amount := (requested_recommendation #>> '{offer,amountMinorUnits}')::bigint;
    if result_row.result #>> '{revisedOffer,status}' is distinct from 'PRESENT'
      or result_row.result #>> '{revisedOffer,amountMinorUnits}' is distinct from expected_amount::text
      or result_row.result #>> '{revisedOffer,currency}' is distinct from requested_recommendation #>> '{offer,currency}'
    then raise exception using errcode='22023', message='Recommendation offer does not match the analyzed response.'; end if;
    select count(*) into offer_count from public.total_loss_offers
      where source_communication_id = job_row.response_communication_id and case_id = job_row.case_id
        and status = 'recorded';
    if offer_count > 1 then raise exception using errcode='55000', message='Response offer identity is ambiguous.'; end if;
    select * into offer_row from public.total_loss_offers
      where source_communication_id = job_row.response_communication_id and case_id = job_row.case_id
        and status = 'recorded';
    if requested_recommendation #>> '{offer,source}' = 'CUSTOMER_RECORDED' then
      if offer_row.id is null or offer_row.amount_minor_units <> expected_amount
        or offer_row.currency <> requested_recommendation #>> '{offer,currency}'
        or workflow_row.current_offer_id is distinct from offer_row.id
      then raise exception using errcode='22023', message='Customer-recorded offer does not match its exact saved amount.'; end if;
      effective_offer_id := offer_row.id;
    else
      if offer_row.id is not null
        or requested_recommendation #>> '{offer,currency}' is distinct from 'USD'
        or result_row.result #> '{revisedOffer,visualSourceInterpretation}' is distinct from 'null'::jsonb
        or result_row.result #>> '{revisedOffer,source}' is distinct from 'INSURER_RESPONSE'
      then raise exception using errcode='22023', message='Response text cannot replace an existing or unverified offer.'; end if;
      select exists (
        select 1 from jsonb_array_elements(result_row.evidence_index -> 'responseEvidence') as evidence(value)
        cross join lateral regexp_matches(evidence.value ->> 'content',
          '(?:USD[[:space:]]*\$?[[:space:]]*|\$[[:space:]]*)([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.([0-9]{2}))?\y','gi') as money(parts)
        where evidence.value ->> 'sourceType' in ('PASTED_TEXT','DOCUMENT_TEXT')
          and result_row.result #> '{revisedOffer,responseEvidenceRefs}' ? (evidence.value ->> 'evidenceRef')
          and replace(money.parts[1],',','')::numeric * 100 + coalesce(money.parts[2],'0')::numeric = expected_amount
      ) into literal_offer;
      if not literal_offer then raise exception using errcode='22023', message='Response offer lacks literal saved text evidence.'; end if;
      select previous_offer.id into previous_offer_id
        from public.total_loss_communications as response
        join public.total_loss_offers as previous_offer
          on previous_offer.source_communication_id=response.supersedes_communication_id
          and previous_offer.case_id=response.case_id and previous_offer.status='superseded'
        where response.id=job_row.response_communication_id and response.case_id=job_row.case_id
        order by previous_offer.received_at desc,previous_offer.id desc limit 1;
      insert into public.total_loss_offers (
        case_id,negotiation_round_id,source_communication_id,amount_minor_units,currency,
        offer_kind,status,received_at,supersedes_offer_id
      ) select job_row.case_id,job_row.negotiation_round_id,job_row.response_communication_id,
          expected_amount,requested_recommendation #>> '{offer,currency}',
          'revised_valuation','recorded',communication.occurred_at,previous_offer_id
        from public.total_loss_communications as communication where communication.id = job_row.response_communication_id
        returning id into effective_offer_id;
    end if;
  elsif requested_recommendation ->> 'state' = 'ACCEPT_OFFER' then
    raise exception using errcode='22023', message='Accept recommendation requires a usable exact offer.';
  end if;

  select recommendation.id into previous_recommendation_id
    from public.total_loss_communications as response
    join public.total_loss_insurer_response_analysis_results as prior
      on prior.response_communication_id = response.supersedes_communication_id and prior.case_id = response.case_id
    join public.total_loss_recommendations as recommendation on recommendation.source_analysis_result_id = prior.id
    where response.id = job_row.response_communication_id and response.case_id = job_row.case_id;
  insert into public.total_loss_recommendations (
    case_id,negotiation_round_id,version_number,recommendation_type,recommendation,evidence_references,
    generation_method,status,recommendation_digest,supersedes_recommendation_id,published_at,
    source_analysis_result_id,source_report_version_id,source_final_assessment_id,source_offer_id,
    source_analysis_result_digest,source_evidence_index_digest,source_report_digest,source_assessment_digest
  ) values (
    job_row.case_id,job_row.negotiation_round_id,
    (select coalesce(max(version_number),0)+1 from public.total_loss_recommendations where negotiation_round_id=job_row.negotiation_round_id),
    'insurer_response_valuation',requested_recommendation,
    (requested_recommendation -> 'responseEvidenceRefs') || (requested_recommendation -> 'caseEvidenceRefs'),
    'deterministic','published',requested_recommendation_digest,previous_recommendation_id,statement_timestamp(),
    result_row.id,report_row.id,assessment_row.id,effective_offer_id,result_row.result_digest,
    result_row.evidence_index_digest,report_row.report_digest,assessment_row.assessment_digest
  ) returning * into recommendation_row;
  update public.total_loss_claim_workflows as workflow
    set current_recommendation_id=recommendation_row.id,
      current_offer_id=coalesce(effective_offer_id,workflow.current_offer_id), revision=workflow.revision+1
    where case_id=job_row.case_id returning * into workflow_row;
  insert into public.total_loss_workflow_events (
    case_id,event_type,actor_type,associated_entity_type,associated_entity_id,details
  ) values (job_row.case_id,'insurer_response.recommendation_published','system',
    'total_loss_recommendation',recommendation_row.id,jsonb_build_object(
      'analysisResultId',result_row.id,'responseId',job_row.response_communication_id,
      'policyVersion',requested_recommendation ->> 'policyVersion','workflowRevision',workflow_row.revision));
  return jsonb_build_object('outcome','published','recommendationId',recommendation_row.id,
    'workflowRevision',workflow_row.revision);
end;
$$;

create function public.complete_total_loss_response_analysis_with_recommendation(
  requested_job_id uuid, requested_processing_token uuid, requested_run_id uuid,
  requested_returned_model_identifier text, requested_input_digest text, requested_result jsonb,
  requested_result_digest text, requested_usage_metadata jsonb, requested_extraction_version text,
  requested_extraction jsonb, requested_extraction_digest text, requested_verified_document_digest text,
  requested_evidence_index jsonb, requested_evidence_index_digest text,
  requested_recommendation jsonb, requested_recommendation_digest text
)
returns table (outcome text,status text,workflow_revision bigint)
language plpgsql volatile security definer set search_path = ''
as $$
declare completion record; result_id uuid; source_case_id uuid; publication jsonb;
begin
  select case_id into source_case_id from public.total_loss_insurer_response_analysis_jobs where id=requested_job_id;
  if source_case_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('total_loss_insurer_response'),
      pg_catalog.hashtext(source_case_id::text));
  end if;
  select * into completion from public.complete_total_loss_insurer_response_analysis(
    requested_job_id,requested_processing_token,requested_run_id,requested_returned_model_identifier,
    requested_input_digest,requested_result,requested_result_digest,requested_usage_metadata,
    requested_extraction_version,requested_extraction,requested_extraction_digest,
    requested_verified_document_digest,requested_evidence_index,requested_evidence_index_digest);
  if completion.outcome in ('completed','duplicate') then
    select id into result_id from public.total_loss_insurer_response_analysis_results where job_id=requested_job_id;
    publication := public.publish_total_loss_insurer_response_recommendation(
      result_id,requested_recommendation,requested_recommendation_digest);
    if publication ->> 'outcome' = 'superseded' then
      return query select 'superseded'::text,'superseded'::text,(publication ->> 'workflowRevision')::bigint;
      return;
    end if;
    return query select completion.outcome::text,completion.status::text,(publication ->> 'workflowRevision')::bigint;
  else return query select completion.outcome::text,completion.status::text,completion.workflow_revision::bigint;
  end if;
end;
$$;

create function public.clear_total_loss_response_recommendation_on_correction()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.current_response_analysis_job_id is distinct from old.current_response_analysis_job_id then
    new.current_recommendation_id := null;
  end if;
  return new;
end;
$$;
create trigger total_loss_claim_workflows_z_clear_response_recommendation
before update on public.total_loss_claim_workflows
for each row execute function public.clear_total_loss_response_recommendation_on_correction();
revoke execute on function public.clear_total_loss_response_recommendation_on_correction()
  from public,anon,authenticated,service_role;

alter function public.total_loss_insurer_response_projection_internal(uuid,uuid)
  rename to total_loss_insurer_response_projection_before_recommendation;
revoke execute on function public.total_loss_insurer_response_projection_before_recommendation(uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.total_loss_insurer_response_projection_internal(requested_case_id uuid,requested_response_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare projection jsonb; recommendation_row public.total_loss_recommendations%rowtype;
  decision_row public.total_loss_insurer_response_decisions%rowtype; offer_row public.total_loss_offers%rowtype;
begin
  projection := public.total_loss_insurer_response_projection_before_recommendation($1,$2);
  if projection is null then return null; end if;
  select recommendation.* into recommendation_row from public.total_loss_recommendations as recommendation
    join public.total_loss_insurer_response_analysis_results as result
      on result.id=recommendation.source_analysis_result_id and result.case_id=recommendation.case_id
    where result.response_communication_id=$2 and result.case_id=$1 and recommendation.status='published';
  if recommendation_row.id is not null then
    select * into offer_row from public.total_loss_offers
      where id=recommendation_row.source_offer_id and case_id=$1;
    select * into decision_row from public.total_loss_insurer_response_decisions
      where recommendation_id=recommendation_row.id and case_id=$1;
  end if;
  return projection || jsonb_build_object(
    'recommendation',case when recommendation_row.id is null then null else
      (recommendation_row.recommendation - 'offer' - 'policyInput') || jsonb_build_object(
        'recommendationId',recommendation_row.id,'versionNumber',recommendation_row.version_number,
        'analysisResultId',recommendation_row.source_analysis_result_id) end,
    'usableOffer',case when offer_row.id is null then null else jsonb_build_object(
      'offerId',offer_row.id,'amountMinorUnits',offer_row.amount_minor_units,'currency',offer_row.currency,
      'source',recommendation_row.recommendation #>> '{offer,source}') end,
    'decision',case when decision_row.id is null then null else jsonb_build_object(
      'decisionId',decision_row.id,'clientRequestId',decision_row.client_request_id,
      'recommendationId',decision_row.recommendation_id,'analysisResultId',decision_row.analysis_result_id,
      'choice',decision_row.choice,'offerId',decision_row.offer_id,
      'amountMinorUnits',decision_row.offer_amount_minor_units,'currency',decision_row.offer_currency,
      'recordedAt',decision_row.created_at) end);
end;
$$;
revoke execute on function public.total_loss_insurer_response_projection_internal(uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.record_total_loss_insurer_response_decision(
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
  select * into resume_row from public.resolve_total_loss_case_claim(requested_case_id);
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

revoke execute on function public.resolve_total_loss_response_recommendation_processing_context(uuid,uuid),
  public.resolve_current_total_loss_response_recommendation_context(uuid),
  public.publish_total_loss_insurer_response_recommendation(uuid,jsonb,text),
  public.complete_total_loss_response_analysis_with_recommendation(uuid,uuid,uuid,text,text,jsonb,text,jsonb,text,jsonb,text,text,jsonb,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.resolve_total_loss_response_recommendation_processing_context(uuid,uuid),
  public.resolve_current_total_loss_response_recommendation_context(uuid),
  public.publish_total_loss_insurer_response_recommendation(uuid,jsonb,text),
  public.complete_total_loss_response_analysis_with_recommendation(uuid,uuid,uuid,text,text,jsonb,text,jsonb,text,jsonb,text,text,jsonb,text,jsonb,text)
  to service_role;
revoke execute on function public.record_total_loss_insurer_response_decision(uuid,uuid,uuid,uuid,text,uuid,bigint)
  from public,anon,service_role;
grant execute on function public.record_total_loss_insurer_response_decision(uuid,uuid,uuid,uuid,text,uuid,bigint)
  to authenticated;

notify pgrst,'reload schema';
