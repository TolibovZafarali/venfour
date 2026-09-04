begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values
  ('b1000000-0000-4000-8000-000000000001', 'analysis-owner@example.test', statement_timestamp(), false),
  ('b1000000-0000-4000-8000-000000000002', 'analysis-other@example.test', statement_timestamp(), false);

insert into public.appraisal_cases (id, user_id, service_type, status)
values (
  'b2000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'total_loss', 'check_complete'
);

insert into public.total_loss_case_details (
  case_id, intake_mode, vin, vehicle_year, vehicle_make, vehicle_model,
  vehicle_trim, mileage_at_loss, postal_code, date_of_loss, insurer_name,
  insurer_vehicle_valuation, intake_completed_at, analysis_input_revision,
  analysis_input_id
) values (
  'b2000000-0000-4000-8000-000000000001', 'manual',
  '1HGCM82633A004352', 2022, 'Honda', 'Accord', 'EX-L', 32000,
  '60601', '2026-08-20', 'Example Insurance', 18000,
  statement_timestamp(), 1, 'b3000000-0000-4000-8000-000000000001'
);

insert into public.total_loss_case_contacts (
  case_id, full_name, email, service_terms_version,
  service_terms_acknowledged_at, privacy_notice_version,
  privacy_notice_acknowledged_at, operational_follow_up_allowed,
  operational_follow_up_updated_at
) values (
  'b2000000-0000-4000-8000-000000000001', 'Analysis Customer',
  'analysis-owner@example.test', '2026-08-23', statement_timestamp(),
  '2026-08-23', statement_timestamp(), false, statement_timestamp()
);

insert into public.total_loss_analysis_jobs (
  id, case_id, source_details_updated_at, status, attempt_count,
  processing_token, run_id, finished_at, source_intake_mode,
  source_analysis_input_revision, source_analysis_input_id
) values (
  'b4000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001', statement_timestamp(),
  'completed', 1, gen_random_uuid(),
  'b5000000-0000-4000-8000-000000000001', statement_timestamp(),
  'manual', 1, 'b3000000-0000-4000-8000-000000000001'
);

insert into public.analysis_runs (
  id, job_id, case_id, artifact, request_digest,
  analysis_run_schema_version, analysis_version,
  discrepancy_analysis_version, comparable_scoring_version
) values (
  'b5000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'runId', 'b5000000-0000-4000-8000-000000000001',
    'result', jsonb_build_object(
      'discrepancyResult', jsonb_build_object(
        'classification', 'MATERIAL_UNDERVALUE_SIGNAL'
      )
    )
  ),
  repeat('1', 64), '4', '4', '1', '1'
);

insert into public.total_loss_preliminary_snapshots (
  id, case_id, analysis_job_id, analysis_run_id, owner_user_id_at_snapshot,
  source_intake_mode, source_analysis_input_revision, source_analysis_input_id,
  preliminary_classification, insurer_valuation_minor_units,
  supported_range_low_minor_units, supported_range_median_minor_units,
  supported_range_high_minor_units, currency, analysis_run_schema_version,
  analysis_version, discrepancy_analysis_version, comparable_scoring_version,
  presentation_schema_version, snapshot_schema_version, source_references,
  snapshot, snapshot_digest
) values (
  'b6000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000001',
  'b5000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001', 'manual', 1,
  'b3000000-0000-4000-8000-000000000001',
  'MATERIAL_UNDERVALUE_SIGNAL', 1800000, 2000000, 2100000, 2200000,
  'USD', '4', '4', '1', '1', '1', '1',
  jsonb_build_object('analysisRunId', 'b5000000-0000-4000-8000-000000000001'),
  jsonb_build_object('classification', 'MATERIAL_UNDERVALUE_SIGNAL'),
  repeat('2', 64)
);

insert into public.total_loss_claim_workflows (
  case_id, preliminary_snapshot_id, phase, current_task
) values (
  'b2000000-0000-4000-8000-000000000001',
  'b6000000-0000-4000-8000-000000000001',
  'review', 'awaiting_report_generation'
);

insert into public.commerce_orders (
  id, case_id, purchaser_user_id, preliminary_snapshot_id,
  product_identifier, product_version, amount_minor_units, currency,
  payment_provider, external_price_identifier, provider_livemode,
  purchaser_email, status, terms_version, refund_policy_version, paid_at
) values (
  'b7000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'b6000000-0000-4000-8000-000000000001',
  'total-loss-package', '1', 9900, 'USD', 'stripe',
  'price_test_analysis_v1', false, 'analysis-owner@example.test',
  'paid', 'terms-1', 'refund-1', statement_timestamp()
);

insert into public.case_entitlements (
  id, case_id, order_id, preliminary_snapshot_id, product_identifier,
  product_version, status
) values (
  'b8000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b7000000-0000-4000-8000-000000000001',
  'b6000000-0000-4000-8000-000000000001',
  'total-loss-package', '1', 'active'
);

insert into public.total_loss_package_jobs (
  id, case_id, entitlement_id, preliminary_snapshot_id, status,
  attempt_count, processing_token, started_at, finished_at
) values (
  'b9000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b8000000-0000-4000-8000-000000000001',
  'b6000000-0000-4000-8000-000000000001',
  'ready', 1, gen_random_uuid(), statement_timestamp(), statement_timestamp()
);

update public.total_loss_claim_workflows
set current_package_job_id = 'b9000000-0000-4000-8000-000000000001',
    revision = revision + 1
where case_id = 'b2000000-0000-4000-8000-000000000001';

insert into public.total_loss_final_assessments (
  id, case_id, package_job_id, preliminary_snapshot_id,
  version_number, conclusion_code, currency,
  supported_range_low_minor_units, supported_range_median_minor_units,
  supported_range_high_minor_units, findings, limitations, reason_codes,
  preliminary_to_final_comparison, assessment, methodology_version,
  schema_version, assessment_digest
) values (
  'ba000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b9000000-0000-4000-8000-000000000001',
  'b6000000-0000-4000-8000-000000000001', 1,
  'MATERIAL_UNDERVALUE_SIGNAL', 'USD', 2000000, 2100000, 2200000,
  jsonb_build_array('The saved market evidence remains above the original offer.'),
  jsonb_build_array('Advertised prices are not guaranteed transaction prices.'),
  jsonb_build_array('SUPPORTED_RANGE_ABOVE_ORIGINAL_OFFER'),
  jsonb_build_object('materialChange', false),
  jsonb_build_object('schemaVersion', '1'),
  '1', '1', repeat('6', 64)
);

insert into public.total_loss_report_series (
  id, case_id, product_identifier, report_kind
) values (
  'bb000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'total-loss-package', 'valuation-evidence-package'
);

insert into public.total_loss_claim_documents (
  id, case_id, document_kind, storage_bucket_id, storage_object_name,
  original_filename, media_type, byte_size, content_digest, status, sealed_at
) values (
  'bc000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'valuation_evidence_report', 'case-deliverables',
  'cases/b2000000-0000-4000-8000-000000000001/reports/bb000000-0000-4000-8000-000000000001/versions/bd000000-0000-4000-8000-000000000001/report.pdf',
  'report.pdf', 'application/pdf', 321, repeat('8', 64),
  'ready', statement_timestamp()
);

insert into public.total_loss_report_versions (
  id, case_id, report_series_id, version_number, final_assessment_id,
  preliminary_snapshot_id, document_id, renderer_version, template_version,
  schema_version, report, report_digest, status, published_at, package_job_id
) values (
  'bd000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'bb000000-0000-4000-8000-000000000001', 1,
  'ba000000-0000-4000-8000-000000000001',
  'b6000000-0000-4000-8000-000000000001',
  'bc000000-0000-4000-8000-000000000001', '1', '1', '1',
  jsonb_build_object(
    'executiveConclusion', jsonb_build_object(
      'insurerValuation', jsonb_build_object(
        'value', jsonb_build_object(
          'minorUnits', 1800000,
          'currency', 'USD',
          'display', '$18,000.00'
        )
      )
    ),
    'insurerComparableReview', jsonb_build_object(
      'summary', jsonb_build_object('count', 1),
      'comparables', jsonb_build_array(jsonb_build_object(
        'vehicle', '2022 Honda Accord EX-L',
        'advertisedPrice', '$20,500.00',
        'adjustedValue', '$20,900.00'
      ))
    ),
    'independentMarketEvidence', jsonb_build_object(
      'primary', jsonb_build_object(
        'label', 'Primary current market evidence',
        'description', 'One approved current-market summary.',
        'evidenceBasis', 'CURRENT_MARKET',
        'count', 1
      )
    )
  ),
  repeat('7', 64), 'published', statement_timestamp(),
  'b9000000-0000-4000-8000-000000000001'
);

update public.total_loss_report_series
set current_report_version_id = 'bd000000-0000-4000-8000-000000000001',
    current_published_report_version_id = 'bd000000-0000-4000-8000-000000000001'
where id = 'bb000000-0000-4000-8000-000000000001';

insert into public.total_loss_negotiation_rounds (
  id, case_id, round_number, status
) values (
  'be000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  1, 'waiting_for_insurer'
);

insert into public.total_loss_message_drafts (
  id, case_id, negotiation_round_id, report_version_id,
  purpose, recipient, subject, body
) values (
  'be100000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  null,
  'bd000000-0000-4000-8000-000000000001',
  'initial_reconsideration', 'adjuster@example.test',
  'Valuation review request',
  'Please review the attached evidence and reconsider the vehicle valuation.'
);

insert into public.total_loss_message_versions (
  id, case_id, message_draft_id, negotiation_round_id, report_version_id,
  version_number, message_state, purpose, recipient, subject, body,
  message_digest, sent_at
) values (
  'be200000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'be100000-0000-4000-8000-000000000001',
  'be000000-0000-4000-8000-000000000001',
  'bd000000-0000-4000-8000-000000000001',
  1, 'customer_reported_sent', 'initial_reconsideration',
  'adjuster@example.test', 'Valuation review request',
  'Please review the attached evidence and reconsider the vehicle valuation.',
  repeat('9', 64), statement_timestamp()
);

insert into public.total_loss_communications (
  id, case_id, negotiation_round_id, direction, channel,
  communication_type, status, sender, recipient, subject, original_content,
  occurred_at, confirmed_at, recorded_by_user_id, message_version_id
) values (
  'be300000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'be000000-0000-4000-8000-000000000001',
  'outbound', 'email', 'initial_reconsideration_request', 'confirmed',
  'analysis-owner@example.test', 'adjuster@example.test',
  'Valuation review request',
  'Please review the attached evidence and reconsider the vehicle valuation.',
  statement_timestamp(), statement_timestamp(),
  'b1000000-0000-4000-8000-000000000001',
  'be200000-0000-4000-8000-000000000001'
);

update public.total_loss_negotiation_rounds
set originating_communication_id = 'be300000-0000-4000-8000-000000000001',
    revision = revision + 1
where id = 'be000000-0000-4000-8000-000000000001';

update public.total_loss_claim_workflows
set phase = 'negotiation',
    current_task = 'awaiting_insurer_response',
    current_report_version_id = 'bd000000-0000-4000-8000-000000000001',
    current_negotiation_round_id = 'be000000-0000-4000-8000-000000000001',
    revision = revision + 1
where case_id = 'b2000000-0000-4000-8000-000000000001';

create temporary table valid_result on commit drop as
select jsonb_build_object(
  'schemaVersion', '1',
  'analysisSummary', jsonb_build_object(
    'whatInsurerSaid', 'The insurer maintained the original offer.',
    'whatThisMeans', 'The saved request was not accepted and the valuation issue remains unresolved.',
    'responseEvidenceRefs', jsonb_build_array('response_' || repeat('a', 64)),
    'caseEvidenceRefs', jsonb_build_array('case_' || repeat('b', 64))
  ),
  'insurerPosition', jsonb_build_object(
    'category', 'MAINTAINS_PRIOR_POSITION',
    'summary', 'The prior valuation position remains unchanged.',
    'responseEvidenceRefs', jsonb_build_array('response_' || repeat('a', 64))
  ),
  'revisedOffer', jsonb_build_object(
    'status', 'ABSENT', 'amountMinorUnits', null, 'currency', null,
    'source', null, 'visualSourceInterpretation',null,'responseEvidenceRefs', jsonb_build_array()
  ),
  'requestDisposition', jsonb_build_object(
    'category', 'REJECTED',
    'summary', 'The insurer did not agree to reconsider the valuation.',
    'responseEvidenceRefs', jsonb_build_array('response_' || repeat('a', 64)),
    'caseEvidenceRefs', jsonb_build_array('case_' || repeat('b', 64))
  ),
  'responsePoints', jsonb_build_array(jsonb_build_object(
    'topic', 'Original offer', 'disposition', 'REJECTED',
    'whatInsurerSaid', 'The original offer is unchanged.',
    'whatThisMeans', 'No revised offer was made.',
    'responseEvidenceRefs', jsonb_build_array('response_' || repeat('a', 64)),
    'caseEvidenceRefs', jsonb_build_array('case_' || repeat('b', 64)),
    'confidence', 'HIGH'
  )),
  'insurerArguments', jsonb_build_array(),
  'importantChanges', jsonb_build_array(),
  'unresolvedIssues', jsonb_build_array(jsonb_build_object(
    'description', 'The supported-range evidence was not addressed.',
    'responseEvidenceRefs', jsonb_build_array('response_' || repeat('a', 64)),
    'caseEvidenceRefs', jsonb_build_array('case_' || repeat('b', 64))
  )),
  'recommendedNextStep', jsonb_build_object(
    'category', 'FOLLOW_UP_APPEARS_WARRANTED',
    'explanation', 'Review the unchanged position before deciding whether to follow up.',
    'responseEvidenceRefs', jsonb_build_array('response_' || repeat('a', 64)),
    'caseEvidenceRefs', jsonb_build_array('case_' || repeat('b', 64))
  ),
  'confidence', 'HIGH',
  'uncertainties', jsonb_build_array(),
  'inputCoverage', jsonb_build_object(
    'pastedText', 'AVAILABLE', 'document', 'NOT_PROVIDED',
    'limitations', jsonb_build_array()
  ),
  'untrustedInstructionDetected', true,
  'untrustedInstructionFollowed', false
) as result;

create temporary table valid_evidence_index on commit drop as
select jsonb_build_object(
  'responseEvidence', jsonb_build_array(jsonb_build_object(
    'evidenceRef', 'response_' || repeat('a', 64),
    'sourceType', 'PASTED_TEXT',
    'content', 'The original offer is unchanged.',
    'pageNumber', null
  )),
  'caseEvidence', jsonb_build_array(jsonb_build_object(
    'evidenceRef', 'case_' || repeat('b', 64),
    'evidenceType', 'CUSTOMER_REQUEST',
    'summary', 'The customer requested reconsideration of the saved valuation.',
    'amountMinorUnits', null,
    'currency', null
  ))
) as evidence_index;

create temporary table scenario (name text primary key,payload jsonb) on commit drop;
create temporary table observed_contexts(job_id uuid primary key,context jsonb) on commit drop;
grant select,insert,update on scenario,valid_result,valid_evidence_index to authenticated,service_role;

create function pg_temp.recommendation(recommended_state text,offer_source text default 'CUSTOMER_RECORDED')
returns jsonb language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'schemaVersion','1','policyVersion','2','state',recommended_state,
    'summary','The saved valuation evidence informs this recommendation.',
    'reasons',jsonb_build_array('The response is compared with the saved evidence, not a new valuation.'),
    'reasonCodes',jsonb_build_array('SAVED_EVIDENCE_REVIEWED'),
    'limitations',jsonb_build_array('Advertised prices are not guaranteed transaction prices.'),
    'responseEvidenceRefs',jsonb_build_array('response_' || repeat('a',64)),
    'caseEvidenceRefs',jsonb_build_array('case_' || repeat('b',64)),
    'offer',case when offer_source is null then null else jsonb_build_object(
      'amountMinorUnits',2050000,'currency','USD','source',offer_source) end,
    'policyInput',jsonb_build_object(
      'assessmentDigest',assessment.assessment_digest,
      'finalClassification',assessment.assessment -> 'finalClassification',
      'evidenceStrength',assessment.assessment -> 'evidenceStrength',
      'evidenceBasis',assessment.assessment -> 'evidenceBasis',
      'continuationStatus',assessment.assessment -> 'continuationStatus',
      'supportedRange',assessment.assessment -> 'supportedRange',
      'validationIssues',coalesce(assessment.assessment -> 'validationIssues','[]'::jsonb),
      'preliminaryToFinalComparison',assessment.assessment -> 'preliminaryToFinalComparison',
      'insurerValuationReviewed',assessment.assessment -> 'insurerValuationReviewed',
      'limitations',coalesce(assessment.assessment -> 'limitations','[]'::jsonb),
      'assumptions',coalesce(assessment.assessment -> 'assumptions','[]'::jsonb)))
  from public.total_loss_final_assessments as assessment
  where assessment.id='ba000000-0000-4000-8000-000000000001';
$$;

create function pg_temp.complete_response(recommendation jsonb,include_recommendation boolean default true)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
declare claim record; token uuid:=gen_random_uuid(); completion record; payload jsonb; evidence jsonb;
begin
  select * into claim from public.claim_current_total_loss_insurer_response_analysis(
    'b2000000-0000-4000-8000-000000000001',token,'analysis-provider','response-model-v1','1','1','1');
  insert into pg_temp.observed_contexts select claim.job_id,analysis_context from public.resolve_total_loss_insurer_response_analysis_context(claim.job_id,token);
  select result into payload from pg_temp.valid_result;
  select evidence_index into evidence from pg_temp.valid_evidence_index;
  if include_recommendation then
    select * into completion from public.complete_total_loss_response_analysis_with_recommendation(
      claim.job_id,token,claim.run_id,'response-model-v1',repeat('c',64),payload,
      public.total_loss_canonical_jsonb_digest(payload),'{}',null,null,null,null,evidence,
      public.total_loss_canonical_jsonb_digest(evidence),recommendation,
      public.total_loss_canonical_jsonb_digest(recommendation));
  else
    select * into completion from public.complete_total_loss_insurer_response_analysis(
      claim.job_id,token,claim.run_id,'response-model-v1',repeat('c',64),payload,
      public.total_loss_canonical_jsonb_digest(payload),'{}',null,null,null,null,evidence,
      public.total_loss_canonical_jsonb_digest(evidence));
  end if;
  return to_jsonb(completion);
end;
$$;

select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);

create temporary table rounds_snapshot(round_number integer primary key,claim_row jsonb) on commit drop;
create temporary table sources_snapshot(round_number integer primary key,response_id uuid,job_id uuid,result_id uuid,recommendation_id uuid,
  decision_id uuid,outbound_id uuid,followup_id uuid,prepared_id uuid,sent_request_id uuid,original_request_id uuid,correction_id uuid,
  superseded_draft_id uuid,superseded_response_id uuid,superseded_decision_id uuid,
  superseded_subject text,superseded_body text) on commit drop;

grant select on rounds_snapshot,sources_snapshot to authenticated;

create function pg_temp.run_rounds() returns setof text language plpgsql security definer set search_path=public,extensions as $$
declare current_claim public.total_loss_case_claim_resume_result; after_claim public.total_loss_case_claim_resume_result;
  response jsonb; decision jsonb; context jsonb; generation jsonb; draft jsonb; prepared jsonb; sent jsonb; token uuid;
  initial_response_id uuid; original_request_id uuid; request_id uuid; outbound_id uuid; prior_round_id uuid; response_id uuid;
  earlier_job_id uuid; earlier_recommendation_id uuid; earlier_decision_id uuid; corrected_response_id uuid;
  analysis_claim record; analysis_context record; n integer; prior_rounds integer; rejected boolean; event_revision bigint;
  upload_id uuid; abandoned_upload_id uuid; permit_number integer;
  superseded_draft_id uuid; superseded_subject text; superseded_body text; current_snapshot jsonb;
begin
  generation:=jsonb_build_object('schemaVersion','1','templateVersion','1','status','READY','generationDigest',repeat('a',64),
    'recipientEmail','adjuster@example.test','subject','Follow-up valuation review',
    'body','Thank you for your response. Please explain how the previously supplied valuation evidence was considered.',
    'grounding',jsonb_build_object('responseEvidenceRefs',jsonb_build_array('response_'||repeat('a',64)),
      'caseEvidenceRefs',jsonb_build_array('case_'||repeat('b',64)),'assessmentEvidenceIds','[]'::jsonb),
    'blockedReasonCode',null,'blockedMessage',null);
  for n in 1..3 loop
    select * into current_claim from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001');
    outbound_id:=(current_claim.response_intake ->> 'outboundCommunicationId')::uuid;
    prior_round_id:=(current_claim.response_intake ->> 'negotiationRoundId')::uuid;
    return next extensions.ok(current_claim.next_task='awaiting_insurer_response' and outbound_id is not null,
      'cycle '||n||' exposes the authoritative waiting intake source');
    if n>1 then
      select count(*) into prior_rounds from public.total_loss_negotiation_rounds where case_id=current_claim.case_id;
      rejected:=false;
      begin
        perform public.record_total_loss_insurer_response(current_claim.case_id,gen_random_uuid(),'Wrong prior outbound',null,null,null,null,
          current_claim.workflow_revision,'be300000-0000-4000-8000-000000000001');
      exception when sqlstate '55000' then rejected:=true; end;
      return next extensions.ok(rejected,'cycle '||n||' rejects a stale initial outbound even with current workflow revision');
      return next extensions.is((select count(*)::integer from public.total_loss_negotiation_rounds where case_id=current_claim.case_id),prior_rounds,
        'rejected stale source cannot create a round');
    end if;
    if n=1 then
      for permit_number in 1..5 loop
        upload_id:=gen_random_uuid(); abandoned_upload_id:=upload_id;
        perform public.prepare_total_loss_insurer_response_upload(current_claim.case_id,upload_id,'reply.pdf','application/pdf',100,repeat('f',64),
          current_claim.workflow_revision,outbound_id,null);
      end loop;
      rejected:=false;
      begin
        perform public.prepare_total_loss_insurer_response_upload(current_claim.case_id,gen_random_uuid(),'reply.pdf','application/pdf',100,repeat('f',64),
          current_claim.workflow_revision,outbound_id,null);
      exception when sqlstate '55000' then rejected:=true; end;
      return next extensions.ok(rejected,'active intake retains the five-permit upload capacity limit');
    elsif n=2 then
      upload_id:=gen_random_uuid();
      perform public.prepare_total_loss_insurer_response_upload(current_claim.case_id,upload_id,'reply.pdf','application/pdf',100,repeat('f',64),
        current_claim.workflow_revision,outbound_id,null);
      return next extensions.ok(exists(select 1 from public.total_loss_insurer_response_upload_sources where document_id=upload_id
        and outbound_communication_id=outbound_id),'later-round upload permit binds its exact outbound despite older unusable permits');
      rejected:=false;
      begin
        perform public.prepare_total_loss_insurer_response_upload(current_claim.case_id,abandoned_upload_id,'reply.pdf','application/pdf',100,repeat('f',64),
          current_claim.workflow_revision,outbound_id,null);
      exception when sqlstate '55000' then rejected:=true; end;
      return next extensions.ok(rejected,'an earlier upload identity cannot be renewed into the next round');
      rejected:=false;
      begin
        perform public.record_total_loss_insurer_response(current_claim.case_id,abandoned_upload_id,'The next reply',null,
          abandoned_upload_id,null,null,current_claim.workflow_revision,outbound_id);
      exception when sqlstate '55000' then rejected:=true; end;
      return next extensions.ok(rejected,'a prior-round document cannot be attached to the current outbound response');
      return next extensions.is((select to_jsonb(resumed) from public.resolve_total_loss_case_claim(current_claim.case_id) resumed),
        to_jsonb(current_claim),'rejected cross-round attachment rolls back round creation and leaves workflow history unchanged');
      return next extensions.is((select count(*)::integer from public.total_loss_negotiation_rounds where case_id=current_claim.case_id),n-1,
        'rejected cross-round attachment creates no additional negotiation round');

    end if;
    request_id:=gen_random_uuid(); original_request_id:=request_id;
    if n=1 then
      response:=public.record_total_loss_insurer_response(current_claim.case_id,request_id,'The original offer is unchanged.',null,null,null,null,current_claim.workflow_revision);
    else
      response:=public.record_total_loss_insurer_response(current_claim.case_id,request_id,'The original offer is unchanged.',
        case when n=3 then 2050000 else null end,null,null,null,current_claim.workflow_revision,outbound_id);
    end if;
    response_id:=(response #>> '{response,responseId}')::uuid; initial_response_id:=response_id;
    return next extensions.ok(response #>> '{response,outboundCommunicationId}'=outbound_id::text
      and (n=1 or response #>> '{response,negotiationRoundId}'<>prior_round_id::text),
      'cycle '||n||' binds a distinct inbound to the exact sent outbound and appropriate round');
    return next extensions.ok(response #> '{response,supersedesResponseId}'='null'::jsonb
      and response #> '{response,decision}'='null'::jsonb and response #> '{response,recommendation}'='null'::jsonb,
      'cycle '||n||' new response has no correction or inherited decision');
    return next extensions.is(public.record_total_loss_insurer_response(current_claim.case_id,request_id,'The original offer is unchanged.',
      case when n=3 then 2050000 else null end,null,null,null,current_claim.workflow_revision,outbound_id),response,
      'cycle '||n||' identical submission retries return the same immutable response');
    rejected:=false;
    begin
      perform public.record_total_loss_insurer_response(current_claim.case_id,request_id,'Changed payload',null,null,null,null,
        current_claim.workflow_revision,outbound_id);
    exception when sqlstate '55000' then rejected:=true; end;
    return next extensions.ok(rejected,'cycle '||n||' request identity cannot be reused with changed material');
    rejected:=false;
    begin
      perform public.record_total_loss_insurer_response(current_claim.case_id,gen_random_uuid(),'Second tab',null,null,null,null,
        current_claim.workflow_revision,outbound_id);
    exception when serialization_failure then rejected:=true; end;
    return next extensions.ok(rejected,'cycle '||n||' concurrent stale-tab revision cannot create a second inbound');
    select * into after_claim from public.resolve_total_loss_case_claim(current_claim.case_id);
    return next extensions.ok(after_claim.next_task='insurer_response_reviewing' and after_claim.response_intake is null,
      'cycle '||n||' resolver resumes reviewing with no next inbound intake');
    select job.id into earlier_job_id from public.total_loss_insurer_response_analysis_jobs job where job.response_communication_id=response_id;
    return next extensions.ok(exists(select 1 from public.total_loss_insurer_response_analysis_jobs job
      join public.total_loss_negotiation_rounds round on round.id=job.negotiation_round_id
      join public.total_loss_communications origin on origin.id=round.originating_communication_id
      where job.id=earlier_job_id and origin.id=outbound_id and job.source_message_version_id=origin.message_version_id
        and job.source_report_version_id='bd000000-0000-4000-8000-000000000001'),
      'cycle '||n||' durable analysis has exact round outbound message and existing report sources');
    if n=3 then
      update pg_temp.valid_result set result=jsonb_set(result,'{revisedOffer}',jsonb_build_object(
        'status','PRESENT','amountMinorUnits',2050000,'currency','USD','source','CUSTOMER_SUPPLIED','visualSourceInterpretation',null,
        'responseEvidenceRefs',jsonb_build_array('response_'||repeat('a',64))));
    end if;
    perform pg_temp.complete_response(pg_temp.recommendation(case when n=3 then 'NO_CLEAR_RECOMMENDATION' else 'CONTINUE_CHALLENGING' end,
      case when n=3 then 'CUSTOMER_RECORDED' else null end));
    select * into after_claim from public.resolve_total_loss_case_claim(current_claim.case_id);
    return next extensions.ok(after_claim.next_task='insurer_response_reviewed' and after_claim.insurer_response -> 'decision'='null'::jsonb,
      'cycle '||n||' produces an independent recommendation requiring an explicit decision');
    decision:=public.record_total_loss_insurer_response_decision(current_claim.case_id,gen_random_uuid(),response_id,
      (after_claim.insurer_response #>> '{recommendation,recommendationId}')::uuid,
      case when n=3 then 'ACCEPT_OFFER' else 'CONTINUE_CHALLENGING' end,
      case when n=3 then (after_claim.insurer_response #>> '{usableOffer,offerId}')::uuid else null end,after_claim.workflow_revision);
    if n<3 then
      earlier_recommendation_id:=(decision #>> '{response,recommendation,recommendationId}')::uuid;
      earlier_decision_id:=(decision #>> '{response,decision,decisionId}')::uuid;
      context:=public.resolve_total_loss_follow_up_generation_context(current_claim.case_id,'b1000000-0000-4000-8000-000000000001',earlier_decision_id);
      draft:=public.store_total_loss_follow_up_draft(current_claim.case_id,'b1000000-0000-4000-8000-000000000001',earlier_decision_id,
        context ->> 'contextDigest',generation);
      superseded_draft_id:=(draft #>> '{draft,draftId}')::uuid;
      if n=1 then
        superseded_subject:=generation ->> 'subject';
        superseded_body:=generation ->> 'body';
      else
        superseded_subject:=format('Round %s exact edited follow-up subject',n);
        superseded_body:=format(E'Round %s exact authored follow-up body.\n\nPreserve only this round.',n);
        draft:=public.patch_total_loss_customer_follow_up_draft(current_claim.case_id,superseded_draft_id,
          format('round-%s-adjuster@example.test',n),superseded_subject,superseded_body,1);
      end if;
      -- Correct the same response in each of the first two rounds, before send.
      select * into after_claim from public.resolve_total_loss_case_claim(current_claim.case_id);
      upload_id:=gen_random_uuid();
      perform public.prepare_total_loss_insurer_response_upload(current_claim.case_id,upload_id,'correction.pdf','application/pdf',100,repeat('e',64),
        after_claim.workflow_revision,outbound_id,response_id);
      return next extensions.ok(exists(select 1 from public.total_loss_insurer_response_upload_sources where document_id=upload_id
        and supersedes_response_id=response_id),'correction upload targets the exact same-round source without stale permits consuming capacity');
      response:=public.record_total_loss_insurer_response(current_claim.case_id,gen_random_uuid(),'The original offer is unchanged. Corrected entry.',
        null,null,null,response_id,after_claim.workflow_revision,outbound_id);
      corrected_response_id:=(response #>> '{response,responseId}')::uuid;
      return next extensions.ok(response #>> '{response,negotiationRoundId}'=after_claim.insurer_response ->> 'negotiationRoundId'
        and response #>> '{response,supersedesResponseId}'=response_id::text
        and response #> '{response,decision}'='null'::jsonb,
        'cycle '||n||' correction stays in the same round and invalidates only current decision lineage');
      select * into after_claim from public.resolve_total_loss_case_claim(current_claim.case_id);
      return next extensions.ok(after_claim.follow_up is null
        and jsonb_array_length(after_claim.negotiation_history -> (n-1) -> 'supersededFollowUpDrafts')=1
        and after_claim.negotiation_history -> (n-1) #>> '{supersededFollowUpDrafts,0,state}'='superseded'
        and after_claim.negotiation_history -> (n-1) #>> '{supersededFollowUpDrafts,0,sourceResponseId}'=response_id::text
        and after_claim.negotiation_history -> (n-1) #>> '{supersededFollowUpDrafts,0,sourceDecisionId}'=earlier_decision_id::text
        and after_claim.negotiation_history -> (n-1) #>> '{supersededFollowUpDrafts,0,draft,draftId}'=superseded_draft_id::text
        and after_claim.negotiation_history -> (n-1) #>> '{supersededFollowUpDrafts,0,draft,subject}'=superseded_subject
        and after_claim.negotiation_history -> (n-1) #>> '{supersededFollowUpDrafts,0,draft,body}'=superseded_body
        and after_claim.negotiation_history -> (n-1) #>> '{supersededFollowUpDrafts,0,draft,revision}'=
          case when n=1 then '1' else '2' end,
        'cycle '||n||' correction exposes only its exact unsent draft while current follow-up is absent');
      current_snapshot:=to_jsonb(after_claim);
      perform public.total_loss_negotiation_history_projection_internal(current_claim.case_id);
      return next extensions.is((select to_jsonb(claim) from public.resolve_total_loss_case_claim(current_claim.case_id) as claim),
        current_snapshot,'cycle '||n||' reading superseded draft history does not alter current workflow state');
      return next extensions.ok(public.resolve_total_loss_follow_up_generation_context(current_claim.case_id,
        'b1000000-0000-4000-8000-000000000001',earlier_decision_id) is null,
        'cycle '||n||' correction makes the previous follow-up source unavailable');
      return next extensions.ok(public.total_loss_insurer_response_projection_internal(current_claim.case_id,response_id)
        #>> '{decision,decisionId}'=earlier_decision_id::text
        and public.total_loss_insurer_response_projection_internal(current_claim.case_id,response_id) ->> 'processingState'='completed'
        and public.total_loss_insurer_response_projection_internal(current_claim.case_id,response_id) -> 'failureReason'='null'::jsonb,
        'cycle '||n||' superseded original keeps its completed review and explicit decision in history');
      rejected:=false;
      begin
        perform public.record_total_loss_insurer_response_decision(current_claim.case_id,gen_random_uuid(),response_id,
          earlier_recommendation_id,'CONTINUE_CHALLENGING',null,(response->>'workflowRevision')::bigint);
      exception when serialization_failure then rejected:=true; end;
      return next extensions.ok(rejected,'cycle '||n||' stale recommendation cannot receive another current decision');
      response_id:=corrected_response_id;
      perform pg_temp.complete_response(pg_temp.recommendation('CONTINUE_CHALLENGING',null));
      select * into after_claim from public.resolve_total_loss_case_claim(current_claim.case_id);
      decision:=public.record_total_loss_insurer_response_decision(current_claim.case_id,gen_random_uuid(),response_id,
        (after_claim.insurer_response #>> '{recommendation,recommendationId}')::uuid,'CONTINUE_CHALLENGING',null,after_claim.workflow_revision);
      context:=public.resolve_total_loss_follow_up_generation_context(current_claim.case_id,'b1000000-0000-4000-8000-000000000001',
        (decision #>> '{response,decision,decisionId}')::uuid);
      return next extensions.ok(context #>> '{sourceIdentity,responseId}'=response_id::text
        and context #>> '{sourceIdentity,outboundCommunicationId}'=outbound_id::text,
        'cycle '||n||' follow-up generation answers the latest corrected response and its exact outbound source');
      draft:=public.store_total_loss_follow_up_draft(current_claim.case_id,'b1000000-0000-4000-8000-000000000001',
        (decision #>> '{response,decision,decisionId}')::uuid,context ->> 'contextDigest',generation);
      return next extensions.ok((draft #>> '{draft,draftId}')::uuid<>superseded_draft_id
        and draft #>> '{draft,subject}'=generation ->> 'subject'
        and draft #>> '{draft,body}'=generation ->> 'body'
        and (n=1 or (draft #>> '{draft,subject}'<>superseded_subject and draft #>> '{draft,body}'<>superseded_body)),
        'cycle '||n||' corrected response creates a distinct generated draft without superseded edits');
      return next extensions.is(public.store_total_loss_follow_up_draft(current_claim.case_id,'b1000000-0000-4000-8000-000000000001',
        (decision #>> '{response,decision,decisionId}')::uuid,context ->> 'contextDigest',generation),draft,
        'cycle '||n||' duplicate follow-up generation reuses its draft');
      select * into after_claim from public.resolve_total_loss_case_claim(current_claim.case_id);
      return next extensions.ok(after_claim.next_task='follow_up_preparation' and after_claim.response_intake is null,
        'cycle '||n||' Continue resolves follow-up preparation without enabling an unsent next response');
      rejected:=false;
      begin
        perform public.record_total_loss_insurer_response(current_claim.case_id,gen_random_uuid(),'Premature next response',null,null,null,null,
          after_claim.workflow_revision,outbound_id);
      exception when sqlstate '55000' then rejected:=true; end;
      return next extensions.ok(rejected,'cycle '||n||' refuses next inbound until follow-up is actually confirmed sent');
      prepared:=public.prepare_total_loss_customer_follow_up(current_claim.case_id,(draft #>> '{draft,draftId}')::uuid,gen_random_uuid(),
        (draft #>> '{draft,revision}')::bigint,after_claim.workflow_revision);
      token:=gen_random_uuid();
      sent:=public.confirm_total_loss_customer_follow_up_sent(current_claim.case_id,(prepared #>> '{messageVersion,messageVersionId}')::uuid,
        token,(prepared ->> 'workflowRevision')::bigint,true);
      return next extensions.is(public.confirm_total_loss_customer_follow_up_sent(current_claim.case_id,
        (prepared #>> '{messageVersion,messageVersionId}')::uuid,token,1,true),sent,
        'cycle '||n||' repeated sent confirmation creates one outbound');
      return next extensions.ok(sent ->> 'communicationId'<>outbound_id::text,
        'cycle '||n||' sends a distinct follow-up without overwriting its source request');
      select * into after_claim from public.resolve_total_loss_case_claim(current_claim.case_id);
      return next extensions.ok(after_claim.next_task='awaiting_insurer_response'
        and after_claim.response_intake ->> 'outboundCommunicationId'=sent ->> 'communicationId'
        and after_claim.negotiation_history -> (n-1) #>> '{followUp,state}'='sent'
        and jsonb_array_length(after_claim.negotiation_history -> (n-1) -> 'supersededFollowUpDrafts')=1
        and after_claim.negotiation_history -> (n-1) #>> '{supersededFollowUpDrafts,0,sourceDecisionId}'=earlier_decision_id::text,
        'cycle '||n||' sent current follow-up remains sent while only the older draft is labeled superseded');
      insert into pg_temp.sources_snapshot values(n,response_id,
        (select id from public.total_loss_insurer_response_analysis_jobs where response_communication_id=response_id),
        (decision #>> '{response,recommendation,analysisResultId}')::uuid,
        (decision #>> '{response,recommendation,recommendationId}')::uuid,(decision #>> '{response,decision,decisionId}')::uuid,
        outbound_id,(sent ->> 'communicationId')::uuid,(prepared #>> '{messageVersion,messageVersionId}')::uuid,token,original_request_id,initial_response_id,
        superseded_draft_id,initial_response_id,earlier_decision_id,superseded_subject,superseded_body);
    else
      select * into after_claim from public.resolve_total_loss_case_claim(current_claim.case_id);
      return next extensions.ok(after_claim.response_intake is null and after_claim.next_task='insurer_response_reviewed'
        and after_claim.insurer_response #>> '{decision,choice}'='ACCEPT_OFFER'
        and after_claim.insurer_response #>> '{decision,offerId}'=after_claim.insurer_response #>> '{usableOffer,offerId}',
        'third-round Accept binds its exact verified offer and leaves no next-response continuation');
      return next extensions.ok((select phase='negotiation' and current_task='insurer_response_received' from public.total_loss_claim_workflows where case_id=current_claim.case_id),
        'Accept awaits later finalization without closing the case or inventing settlement outcome');
      rejected:=false;
      begin
        perform public.record_total_loss_insurer_response(current_claim.case_id,gen_random_uuid(),'After acceptance',null,null,null,null,
          after_claim.workflow_revision,outbound_id);
      exception when sqlstate '55000' then rejected:=true; end;
      return next extensions.ok(rejected,'Accept prevents a new inbound continuation from the accepted response');
    end if;
    insert into pg_temp.rounds_snapshot values(n,to_jsonb(after_claim));
  end loop;
end;
$$;
select * from pg_temp.run_rounds();

select ok((select count(*)=5 and bool_and(context #>> '{customerRequest,body}'=message.body
  and (context #>> '{journey,negotiationRoundNumber}')::integer=round.round_number)
  from observed_contexts observed join public.total_loss_insurer_response_analysis_jobs job on job.id=observed.job_id
  join public.total_loss_negotiation_rounds round on round.id=job.negotiation_round_id
  join public.total_loss_message_versions message on message.id=job.source_message_version_id),
  'all five original/corrected analyses assembled the exact answered request and their own round context');
select is((select count(*)::integer from public.total_loss_negotiation_rounds where case_id='b2000000-0000-4000-8000-000000000001'),3,
  'three inbound responses create exactly three negotiation rounds');
select is((select count(*)::integer from public.total_loss_communications where case_id='b2000000-0000-4000-8000-000000000001'
  and direction='inbound' and supersedes_communication_id is null),3,'three distinct inbound communications are not represented as corrections');
select ok((select count(*)=2 and bool_and(job.status='completed') from sources_snapshot source
  join public.total_loss_insurer_response_analysis_jobs job on job.id=source.job_id),
  'later rounds preserve earlier completed jobs instead of superseding their history');
select ok((select count(distinct recommendation_id)=2 and count(distinct decision_id)=2 and count(distinct followup_id)=2 from sources_snapshot),
  'each completed Continue round has distinct recommendation decision and sent follow-up identities');
select ok((select jsonb_array_length(claim_row->'negotiation_history')=3
  and jsonb_array_length(claim_row#>'{negotiation_history,0,responses}')=2
  and jsonb_array_length(claim_row#>'{negotiation_history,1,responses}')=2
  and claim_row#>'{negotiation_history,0,followUp}'=claim_row#>'{negotiation_history,1,outbound}'
  and claim_row#>'{negotiation_history,1,followUp}'=claim_row#>'{negotiation_history,2,outbound}'
  and claim_row#>>'{negotiation_history,0,followUp,state}'='sent'
  and claim_row#>>'{negotiation_history,1,followUp,state}'='sent'
  and jsonb_array_length(claim_row#>'{negotiation_history,0,supersededFollowUpDrafts}')=1
  and jsonb_array_length(claim_row#>'{negotiation_history,1,supersededFollowUpDrafts}')=1
  and claim_row#>'{negotiation_history,2,supersededFollowUpDrafts}'='[]'::jsonb
  from rounds_snapshot where round_number=3),
  'grouped history retains sent links and only the two corrected-response drafts as superseded');
select ok((select claim_row#>>'{negotiation_history,0,supersededFollowUpDrafts,0,draft,draftId}'=
    (select superseded_draft_id::text from sources_snapshot where round_number=1)
  and claim_row#>>'{negotiation_history,0,supersededFollowUpDrafts,0,sourceResponseId}'=
    (select superseded_response_id::text from sources_snapshot where round_number=1)
  and claim_row#>>'{negotiation_history,0,supersededFollowUpDrafts,0,draft,subject}'=
    (select superseded_subject from sources_snapshot where round_number=1)
  and claim_row#>>'{negotiation_history,0,supersededFollowUpDrafts,0,draft,body}'=
    (select superseded_body from sources_snapshot where round_number=1)
  and claim_row#>>'{negotiation_history,1,supersededFollowUpDrafts,0,draft,draftId}'=
    (select superseded_draft_id::text from sources_snapshot where round_number=2)
  and claim_row#>>'{negotiation_history,1,supersededFollowUpDrafts,0,sourceResponseId}'=
    (select superseded_response_id::text from sources_snapshot where round_number=2)
  and claim_row#>>'{negotiation_history,1,supersededFollowUpDrafts,0,draft,subject}'=
    (select superseded_subject from sources_snapshot where round_number=2)
  and claim_row#>>'{negotiation_history,1,supersededFollowUpDrafts,0,draft,body}'=
    (select superseded_body from sources_snapshot where round_number=2)
  from rounds_snapshot where round_number=3),
  'superseded drafts retain exact per-round content and never cross response or round lineage');
select ok((select bool_and((value->>'canCorrect')::boolean=false) from rounds_snapshot,
  lateral jsonb_array_elements(claim_row#>'{negotiation_history,0,responses}') where round_number=3),
  'historical closed rounds expose read-only responses');
select is(public.confirm_total_loss_customer_follow_up_sent('b2000000-0000-4000-8000-000000000001',
  (select prepared_id from sources_snapshot where round_number=1),(select sent_request_id from sources_snapshot where round_number=1),1,true)->>'communicationId',
  (select followup_id::text from sources_snapshot where round_number=1),'historical sent retry replays its exact outbound after later rounds');
select is(public.record_total_loss_insurer_response('b2000000-0000-4000-8000-000000000001',
  (select original_request_id from sources_snapshot where round_number=1),'The original offer is unchanged.',null,null,null,null,1,
  'be300000-0000-4000-8000-000000000001')#>>'{response,responseId}',
  (select correction_id::text from sources_snapshot where round_number=1),'historical response retry returns original material without changing the current round');
select is((select to_jsonb(resumed) from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001') resumed),
  (select claim_row from rounds_snapshot where round_number=3),'reading history and replaying old requests leaves the authoritative current workflow unchanged');
select throws_ok($$update public.total_loss_negotiation_rounds set originating_communication_id=gen_random_uuid(),revision=revision+1
  where case_id='b2000000-0000-4000-8000-000000000001' and round_number=3$$,'55000',null,'round outbound identity is immutable');
select ok(not has_table_privilege('authenticated','public.total_loss_insurer_response_upload_sources','SELECT,INSERT,UPDATE,DELETE')
  and not has_function_privilege('authenticated','public.prepare_total_loss_insurer_response_upload_internal(uuid,uuid,text,text,bigint,text,bigint)','EXECUTE')
  and not has_function_privilege('authenticated','public.total_loss_superseded_follow_up_drafts_projection_internal(uuid,uuid)','EXECUTE'),
  'upload and superseded-draft source bindings and bypass helpers remain private');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.record_total_loss_insurer_response('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),'Other account',null,null,null,null,1,
  'be300000-0000-4000-8000-000000000001')$$,'42501','Insurer response recording is unavailable.','another owner cannot append to any round');
select ok(not exists(select 1 from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')
  where negotiation_history is not null or response_intake is not null),
  'another account cannot read negotiation history');
reset role;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
update public.case_entitlements set status='suspended' where id='b8000000-0000-4000-8000-000000000001';
select ok((select negotiation_history is null and response_intake is null and next_task='payment_review'
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),'suspended entitlement hides history and intake while preserving resolver attention');
update public.case_entitlements set status='active' where id='b8000000-0000-4000-8000-000000000001';
select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'ACCEPTED_VERIFIED_OFFER',claim.workflow_revision,(claim.insurer_response#>>'{decision,decisionId}')::uuid,
  (claim.insurer_response#>>'{usableOffer,offerId}')::uuid)
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001') claim;
select ok((select customer_journey ->> 'nextState'='resolved' and jsonb_array_length(negotiation_history)=3
  and jsonb_array_length(negotiation_history#>'{0,responses}')=2
  and jsonb_array_length(negotiation_history#>'{1,responses}')=2
  and negotiation_history#>'{0,followUp}'=negotiation_history#>'{1,outbound}'
  and negotiation_history#>'{1,followUp}'=negotiation_history#>'{2,outbound}'
  and negotiation_history#>>'{0,followUp,state}'='sent' and negotiation_history#>>'{1,followUp,state}'='sent'
  and jsonb_array_length(negotiation_history#>'{0,supersededFollowUpDrafts}')=1
  and jsonb_array_length(negotiation_history#>'{1,supersededFollowUpDrafts}')=1
  and negotiation_history#>'{2,supersededFollowUpDrafts}'='[]'::jsonb
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'closure preserves sent follow-ups and exact superseded drafts without relabeling either');
select ok((select bool_and(response ->> 'canCorrect'='false')
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001') claim,
  lateral jsonb_array_elements(claim.negotiation_history) round,
  lateral jsonb_array_elements(round -> 'responses') response),
  'all retained response rounds are read-only after closure');
select throws_ok($$select public.confirm_total_loss_customer_follow_up_sent('b2000000-0000-4000-8000-000000000001',
  (select prepared_id from sources_snapshot where round_number=1),(select sent_request_id from sources_snapshot where round_number=1),1,true)$$,
  '55000','This case is closed and read-only.','even exact historical sent confirmations reject after case closure');
select throws_ok($$select public.record_total_loss_insurer_response('b2000000-0000-4000-8000-000000000001',
  (select original_request_id from sources_snapshot where round_number=1),'The original offer is unchanged.',null,null,null,null,1,
  'be300000-0000-4000-8000-000000000001')$$,
  '55000','This case is closed and read-only.','even exact historical response retries reject after case closure');
select * from finish();
rollback;
