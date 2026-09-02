-- Ground new recommendations in the saved assessment while retaining immutable prior versions.

create or replace function public.total_loss_response_recommendation_is_valid(value jsonb)
returns boolean
language sql immutable parallel safe set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(value) = 'object' and pg_column_size(value) <= 262144
    and value ?& array['schemaVersion','policyVersion','state','summary','reasons',
      'reasonCodes','limitations','responseEvidenceRefs','caseEvidenceRefs','offer','policyInput']
    and (select count(*) = 11 from jsonb_object_keys(value))
    and value ->> 'schemaVersion' = '1'
    and value ->> 'policyVersion' in ('1','2')
    and value ->> 'state' in ('ACCEPT_OFFER','CONTINUE_CHALLENGING','NO_CLEAR_RECOMMENDATION')
    and (value ->> 'policyVersion' = '1' or value ->> 'state' <> 'ACCEPT_OFFER')
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

create or replace function public.publish_total_loss_insurer_response_recommendation(
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

  if requested_recommendation ->> 'policyVersion' <> '2' then
    raise exception using errcode='22023', message='New response recommendations require the current assessment policy.';
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
    'preliminaryToFinalComparison',assessment_row.assessment -> 'preliminaryToFinalComparison',
    'insurerValuationReviewed',assessment_row.assessment -> 'insurerValuationReviewed',
    'limitations',coalesce(assessment_row.assessment -> 'limitations','[]'::jsonb),
    'assumptions',coalesce(assessment_row.assessment -> 'assumptions','[]'::jsonb)
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

-- Previously saved advice remains immutable; customer reads withhold its direction.
create function public.total_loss_response_recommendation_current_projection(value jsonb)
returns jsonb language sql immutable parallel safe set search_path = ''
as $$
  select case when value #>> '{recommendation,policyVersion}' = '1' then
    jsonb_set(value,'{recommendation}',(value -> 'recommendation') || jsonb_build_object(
      'state','NO_CLEAR_RECOMMENDATION',
      'summary','Venfour has no clear recommendation yet.',
      'reasons',jsonb_build_array('The saved advice predates the corrected assessment policy and cannot support a current recommendation.'),
      'reasonCodes',jsonb_build_array('SAVED_RECOMMENDATION_POLICY_SUPERSEDED'),
      'limitations',jsonb_build_array('Advertised listing prices do not establish an insurer settlement target. Your saved offer and any recorded choice are preserved.')
    )) else value end;
$$;
revoke execute on function public.total_loss_response_recommendation_current_projection(jsonb)
  from public,anon,authenticated,service_role;

alter function public.total_loss_insurer_response_projection_internal(uuid,uuid)
  rename to total_loss_insurer_response_projection_before_policy_correction;
revoke execute on function public.total_loss_insurer_response_projection_before_policy_correction(uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.total_loss_insurer_response_projection_internal(requested_case_id uuid,requested_response_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select public.total_loss_response_recommendation_current_projection(
    public.total_loss_insurer_response_projection_before_policy_correction($1,$2));
$$;
revoke execute on function public.total_loss_insurer_response_projection_internal(uuid,uuid)
  from public,anon,authenticated,service_role;
