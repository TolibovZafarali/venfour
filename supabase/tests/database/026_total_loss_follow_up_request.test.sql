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
    'source', null, 'responseEvidenceRefs', jsonb_build_array()
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
select ok(has_function_privilege('service_role','public.resolve_total_loss_follow_up_generation_context(uuid,uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.store_total_loss_follow_up_draft(uuid,uuid,uuid,text,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.store_total_loss_follow_up_draft(uuid,uuid,uuid,text,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.get_total_loss_customer_follow_up(uuid)','EXECUTE')
  and not has_table_privilege('authenticated','public.total_loss_follow_up_sources','SELECT')
  and not has_table_privilege('authenticated','public.total_loss_follow_up_generation_blocks','SELECT'),
  'generation is service-only and source records stay private');

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select is(public.get_total_loss_customer_follow_up('b2000000-0000-4000-8000-000000000001'),null::jsonb,
  'a sent initial request alone does not expose follow-up');
insert into scenario values('response',public.record_total_loss_insurer_response(
  'b2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',
  'The original offer is unchanged.',null,null,null,null,3));
reset role;
select is(pg_temp.complete_response(pg_temp.recommendation('CONTINUE_CHALLENGING',null))->>'outcome','completed',
  'saved response analysis and corrected recommendation are available');
set local role authenticated;
insert into scenario select 'review',to_jsonb(result) from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001') result;
select is(public.get_total_loss_customer_follow_up('b2000000-0000-4000-8000-000000000001'),null::jsonb,
  'analysis without an explicit Continue decision creates no draft');
insert into scenario select 'decision',public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001',
  (payload #>> '{insurer_response,responseId}')::uuid,(payload #>> '{insurer_response,recommendation,recommendationId}')::uuid,
  'CONTINUE_CHALLENGING',null,(payload ->> 'workflow_revision')::bigint) from scenario where name='review';
select is((select next_task from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'follow_up_preparation','Continue resumes follow-up preparation before generation');
select is(public.get_total_loss_customer_follow_up('b2000000-0000-4000-8000-000000000001')->>'state','available',
  'explicit Continue exposes a resumable available state');
select is(public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001',
  (payload #>> '{response,responseId}')::uuid,(payload #>> '{response,recommendation,recommendationId}')::uuid,
  'CONTINUE_CHALLENGING',null,1),payload,'Continue confirmation remains idempotent after resolver advances')
  from scenario where name='decision';
reset role;
insert into scenario select 'context',public.resolve_total_loss_follow_up_generation_context(
  'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',
  (payload #>> '{response,decision,decisionId}')::uuid) from scenario where name='decision';
select ok((select payload #>> '{sourceIdentity,responseId}'=(select payload #>> '{response,responseId}' from scenario where name='response')
  and payload #>> '{sourceIdentity,analysisResultId}'=(select payload #>> '{response,decision,analysisResultId}' from scenario where name='decision')
  and payload #>> '{sourceIdentity,reportId}'='bd000000-0000-4000-8000-000000000001'
  and payload #>> '{sourceIdentity,finalAssessmentId}'='ba000000-0000-4000-8000-000000000001'
  and payload #>> '{sourceIdentity,initialPreparedMessageId}'='be200000-0000-4000-8000-000000000001'
  from scenario where name='context'),'generation context binds exact response analysis report assessment and original sent message');
select is(public.resolve_total_loss_follow_up_generation_context(
  'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002',
  (payload #>> '{sourceIdentity,decisionId}')::uuid),null::jsonb,'another owner cannot obtain follow-up generation sources')
  from scenario where name='context';
insert into scenario values('generation',jsonb_build_object(
  'schemaVersion','1','templateVersion','1','status','READY','generationDigest',repeat('a',64),
  'recipientEmail','adjuster@example.test','subject','Follow-up valuation review',
  'body','Thank you for your response. Please explain how the previously supplied valuation evidence was considered.',
  'grounding',jsonb_build_object('responseEvidenceRefs',jsonb_build_array('response_'||repeat('a',64)),
    'caseEvidenceRefs',jsonb_build_array('case_'||repeat('b',64)),'assessmentEvidenceIds',jsonb_build_array()),
  'blockedReasonCode',null,'blockedMessage',null));
select throws_ok($$select public.store_total_loss_follow_up_draft(
  'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',
  (select (payload #>> '{sourceIdentity,decisionId}')::uuid from scenario where name='context'),repeat('0',64),
  (select payload from scenario where name='generation'))$$,'40001','Follow-up sources changed before generation was saved.',
  'generation commit rejects a stale source digest');
insert into scenario select 'blocked',public.store_total_loss_follow_up_draft(
  'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',
  (payload #>> '{sourceIdentity,decisionId}')::uuid,payload ->> 'contextDigest',jsonb_build_object(
    'schemaVersion','1','templateVersion','1','status','BLOCKED','generationDigest',repeat('b',64),
    'recipientEmail',null,'subject',null,'body',null,'grounding',jsonb_build_object('responseEvidenceRefs','[]'::jsonb,'caseEvidenceRefs','[]'::jsonb,'assessmentEvidenceIds','[]'::jsonb),
    'blockedReasonCode','FOLLOW_UP_EVIDENCE_UNAVAILABLE','blockedMessage','The saved evidence cannot support a follow-up.'))
  from scenario where name='context';
select is((select payload ->> 'state' from scenario where name='blocked'),'unavailable','unsupported generation is a saved recoverable state');
set local role authenticated;
select is(public.get_total_loss_customer_follow_up('b2000000-0000-4000-8000-000000000001')->>'reasonCode',
  'FOLLOW_UP_EVIDENCE_UNAVAILABLE','refresh preserves the clear generation blocker');
reset role;
select throws_ok($$select public.store_total_loss_follow_up_draft(
  'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',
  (select (payload #>> '{sourceIdentity,decisionId}')::uuid from scenario where name='context'),
  (select payload ->> 'contextDigest' from scenario where name='context'),
  jsonb_set((select payload from scenario where name='generation'),'{grounding,responseEvidenceRefs}',
    jsonb_build_array('response_'||repeat('f',64))))$$,'22023','Follow-up generated content is invalid.',
  'unknown evidence citations cannot be persisted by the generation gate');
insert into scenario select 'generated',public.store_total_loss_follow_up_draft(
  'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',
  (payload #>> '{sourceIdentity,decisionId}')::uuid,payload ->> 'contextDigest',(select payload from scenario where name='generation'))
  from scenario where name='context';
select is((select payload ->> 'state' from scenario where name='generated'),'draft','successful retry creates the distinct draft');
select is(public.store_total_loss_follow_up_draft(
  'b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',
  (payload #>> '{sourceIdentity,decisionId}')::uuid,payload ->> 'contextDigest',(select payload from scenario where name='generation')),
  (select payload from scenario where name='generated'),'duplicate generation resumes the same draft') from scenario where name='context';
select is((select count(*)::integer from public.total_loss_message_drafts where purpose='follow_up_reconsideration'),1,'generation retries create one follow-up');
select is((select original_content from public.total_loss_communications where id='be300000-0000-4000-8000-000000000001'),
  'Please review the attached evidence and reconsider the vehicle valuation.','original sent request remains unchanged');
-- Probe corrections in a rolled-back subtransaction so the main send scenario
-- can verify both stale-source failure and the original intact history.
create function pg_temp.probe_follow_up_correction() returns jsonb
language plpgsql security definer set search_path='' as $$
declare old_context jsonb; old_draft uuid; correction jsonb; resumed record; new_context jsonb;
  old_source_rejected boolean:=false; old_edit_rejected boolean:=false; current_hidden boolean:=false;
  replacement_draft uuid; old_source_stale boolean:=false; draft_count integer;
begin
  select payload into old_context from pg_temp.scenario where name='context';
  select (payload #>> '{draft,draftId}')::uuid into old_draft from pg_temp.scenario where name='generated';
  begin
    correction:=public.record_total_loss_insurer_response('b2000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001','The original offer is unchanged. Corrected saved text.',null,null,null,
      (old_context #>> '{sourceIdentity,responseId}')::uuid,
      (select revision from public.total_loss_claim_workflows where case_id='b2000000-0000-4000-8000-000000000001'));
    old_source_stale:=public.resolve_total_loss_follow_up_generation_context('b2000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000001',(old_context #>> '{sourceIdentity,decisionId}')::uuid) is null;
    current_hidden:=public.get_total_loss_customer_follow_up('b2000000-0000-4000-8000-000000000001') is null;
    begin
      perform public.store_total_loss_follow_up_draft('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',
        (old_context #>> '{sourceIdentity,decisionId}')::uuid,old_context ->> 'contextDigest',
        (select payload from pg_temp.scenario where name='generation'));
    exception when insufficient_privilege then old_source_rejected:=true; end;
    begin
      perform public.patch_total_loss_customer_follow_up_draft('b2000000-0000-4000-8000-000000000001',old_draft,
        'adjuster@example.test','Stale','Stale',1);
    exception when insufficient_privilege then old_edit_rejected:=true; end;
    perform pg_temp.complete_response(pg_temp.recommendation('CONTINUE_CHALLENGING',null));
    select * into resumed from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001');
    correction:=public.record_total_loss_insurer_response_decision('b2000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000001',(resumed.insurer_response ->> 'responseId')::uuid,
      (resumed.insurer_response #>> '{recommendation,recommendationId}')::uuid,'CONTINUE_CHALLENGING',null,resumed.workflow_revision);
    new_context:=public.resolve_total_loss_follow_up_generation_context('b2000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000001',(correction #>> '{response,decision,decisionId}')::uuid);
    replacement_draft:=(public.store_total_loss_follow_up_draft('b2000000-0000-4000-8000-000000000001',
      'b1000000-0000-4000-8000-000000000001',(new_context #>> '{sourceIdentity,decisionId}')::uuid,
      new_context ->> 'contextDigest',(select payload from pg_temp.scenario where name='generation')) #>> '{draft,draftId}')::uuid;
    select count(*) into draft_count from public.total_loss_follow_up_sources where case_id='b2000000-0000-4000-8000-000000000001';
    raise exception using errcode='ZX001',message='Rollback correction probe';
  exception when sqlstate 'ZX001' then null; end;
  return jsonb_build_object('staleContext',old_source_stale,'oldGenerationRejected',old_source_rejected,
    'oldEditRejected',old_edit_rejected,'hiddenUntilNewDecision',current_hidden,
    'newDraftIsDistinct',replacement_draft is not null and replacement_draft<>old_draft,'retainedDrafts',draft_count);
end;
$$;
insert into scenario values('correction_probe',pg_temp.probe_follow_up_correction());
select ok((select (payload ->> 'staleContext')::boolean and (payload ->> 'oldGenerationRejected')::boolean
  and (payload ->> 'oldEditRejected')::boolean and (payload ->> 'hiddenUntilNewDecision')::boolean from scenario where name='correction_probe'),
  'corrected response invalidates old analysis generation and editing until a new decision');
select ok((select (payload ->> 'newDraftIsDistinct')::boolean and payload ->> 'retainedDrafts'='2' from scenario where name='correction_probe'),
  'corrected response with its own analysis and Continue creates a distinct draft while preserving prior lineage');

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select is(public.get_total_loss_customer_follow_up('b2000000-0000-4000-8000-000000000001'),null::jsonb,'non-owner follow-up read is hidden');
select throws_ok($$select public.patch_total_loss_customer_follow_up_draft('b2000000-0000-4000-8000-000000000001',
  (select (payload #>> '{draft,draftId}')::uuid from scenario where name='generated'),'adjuster@example.test','Changed','Changed',1)$$,
  '42501','Follow-up draft is unavailable.','non-owner cannot edit the follow-up');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
insert into scenario select 'edited',public.patch_total_loss_customer_follow_up_draft('b2000000-0000-4000-8000-000000000001',
  (payload #>> '{draft,draftId}')::uuid,'another-adjuster@example.test','My edited follow-up','My reviewed follow-up message.',1)
  from scenario where name='generated';
select ok((select payload ->> 'body'='My reviewed follow-up message.' and payload ->> 'revision'='2' from scenario where name='edited'),
  'customer recipient subject and body edits persist with serialized revision');
select is(public.get_total_loss_customer_follow_up('b2000000-0000-4000-8000-000000000001') -> 'draft',
  (select payload from scenario where name='edited'),'refresh returns the exact saved customer edits');
select throws_ok($$select public.patch_total_loss_customer_follow_up_draft('b2000000-0000-4000-8000-000000000001',
  (select (payload ->> 'draftId')::uuid from scenario where name='edited'),'adjuster@example.test','Other tab','Stale edit',1)$$,
  '40001','Message draft changed before this edit.','stale autosave cannot overwrite the newer revision');
select throws_ok($$select public.prepare_total_loss_customer_follow_up('b2000000-0000-4000-8000-000000000001',
  (select (payload ->> 'draftId')::uuid from scenario where name='edited'),'d3000000-0000-4000-8000-000000000001',1,
  (select (payload ->> 'workflowRevision')::bigint from scenario where name='decision'))$$,
  '40001','Message draft changed before preparation.','Copy/Open preparation requires the exact latest saved draft revision');
insert into scenario select 'prepared',public.prepare_total_loss_customer_follow_up('b2000000-0000-4000-8000-000000000001',
  (payload ->> 'draftId')::uuid,'d3000000-0000-4000-8000-000000000001',2,
  (select (payload ->> 'workflowRevision')::bigint from scenario where name='decision')) from scenario where name='edited';
select is((select payload #>> '{messageVersion,body}' from scenario where name='prepared'),'My reviewed follow-up message.',
  'prepared immutable version contains the exact customer edits');
select is(public.prepare_total_loss_customer_follow_up('b2000000-0000-4000-8000-000000000001',
  (payload #>> '{draft,draftId}')::uuid,'d3000000-0000-4000-8000-000000000001',2,(payload ->> 'workflowRevision')::bigint),
  payload,'duplicate preparation reuses its exact immutable version') from scenario where name='prepared';
select is(public.record_total_loss_customer_email_opened('b2000000-0000-4000-8000-000000000001',
  (payload #>> '{messageVersion,messageVersionId}')::uuid,'d4000000-0000-4000-8000-000000000001')->>'authoritativeSent','false',
  'opening email retains the existing non-authoritative event model') from scenario where name='prepared';
insert into scenario select 'edit_after_prepare',public.patch_total_loss_customer_follow_up_draft('b2000000-0000-4000-8000-000000000001',
  (payload #>> '{draft,draftId}')::uuid,'another-adjuster@example.test','My edited follow-up','My final reviewed follow-up.',2) from scenario where name='prepared';
select throws_ok($$select public.confirm_total_loss_customer_follow_up_sent('b2000000-0000-4000-8000-000000000001',
  (select (payload #>> '{messageVersion,messageVersionId}')::uuid from scenario where name='prepared'),
  'd5000000-0000-4000-8000-000000000001',(select (payload ->> 'workflowRevision')::bigint from scenario where name='prepared'),true)$$,
  '40001','Message draft changed after this version was prepared.','sent confirmation rejects a prepared version before the latest edit');
reset role;
select throws_ok($$update public.total_loss_message_versions set body='changed' where id=(select (payload #>> '{messageVersion,messageVersionId}')::uuid from scenario where name='prepared')$$,
  '55000',null,'prepared history cannot be mutated');
select is(public.store_total_loss_follow_up_draft('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',
  (payload #>> '{sourceIdentity,decisionId}')::uuid,payload ->> 'contextDigest',(select payload from scenario where name='generation')) #>> '{draft,body}',
  'My final reviewed follow-up.','generation retries never overwrite customer edits') from scenario where name='context';
set local role authenticated;
insert into scenario select 'final_prepared',public.prepare_total_loss_customer_follow_up('b2000000-0000-4000-8000-000000000001',
  (payload ->> 'draftId')::uuid,'d3000000-0000-4000-8000-000000000002',3,
  (select (payload ->> 'workflowRevision')::bigint from scenario where name='decision')) from scenario where name='edit_after_prepare';
select throws_ok($$select public.confirm_total_loss_customer_follow_up_sent('b2000000-0000-4000-8000-000000000001',
  (select (payload #>> '{messageVersion,messageVersionId}')::uuid from scenario where name='final_prepared'),
  'd5000000-0000-4000-8000-000000000001',(select (payload ->> 'workflowRevision')::bigint from scenario where name='final_prepared'),false)$$,
  '22023','Sent confirmation requires the attached-report acknowledgement.','customer must confirm attaching the report');
insert into scenario select 'sent',public.confirm_total_loss_customer_follow_up_sent('b2000000-0000-4000-8000-000000000001',
  (payload #>> '{messageVersion,messageVersionId}')::uuid,'d5000000-0000-4000-8000-000000000001',(payload ->> 'workflowRevision')::bigint,true)
  from scenario where name='final_prepared';
select is((select payload ->> 'state' from scenario where name='sent'),'awaiting_insurer_response','explicit sent confirmation returns waiting');
select is(public.confirm_total_loss_customer_follow_up_sent('b2000000-0000-4000-8000-000000000001',
  (select (payload #>> '{messageVersion,messageVersionId}')::uuid from scenario where name='final_prepared'),
  'd5000000-0000-4000-8000-000000000001',1,true),(select payload from scenario where name='sent'),
  'same sent request retries are idempotent');
select is(public.confirm_total_loss_customer_follow_up_sent('b2000000-0000-4000-8000-000000000001',
  (select (payload #>> '{messageVersion,messageVersionId}')::uuid from scenario where name='final_prepared'),
  'd5000000-0000-4000-8000-000000000002',1,true),(select payload from scenario where name='sent'),
  'duplicate sent confirmation with a fresh identity still reuses the same communication');
select ok((select next_task='awaiting_insurer_response' and customer_journey ->> 'nextState'='awaiting_insurer_response'
  and follow_up ->> 'state'='sent' and follow_up #>> '{sentMessage,state}'='sent' and follow_up #>> '{sentMessage,body}'='My final reviewed follow-up.'
  and insurer_response #>> '{decision,choice}'='CONTINUE_CHALLENGING'
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'waiting resolver retains the original response decision and sent follow-up history');
select throws_ok($$select public.patch_total_loss_customer_follow_up_draft('b2000000-0000-4000-8000-000000000001',
  (select (payload ->> 'draftId')::uuid from scenario where name='edited'),'adjuster@example.test','After send','No',3)$$,
  '42501','Follow-up draft is unavailable.','sent follow-up is no longer editable');
select throws_ok($$select public.record_total_loss_insurer_response('b2000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000002','Another response.',null,null,null,
  (select (payload #>> '{response,responseId}')::uuid from scenario where name='response'),
  (select (payload ->> 'workflowRevision')::bigint from scenario where name='sent'))$$,
  '55000',null,'the first response cannot be corrected after follow-up sent');
select throws_ok($$select public.record_total_loss_insurer_response('b2000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000003','The next response.',null,null,null,null,
  (select (payload ->> 'workflowRevision')::bigint from scenario where name='sent'))$$,
  '55000','The next insurer response is not available in this case stage.','Response 2 cannot enter the first-response intake');
select throws_ok($$select public.prepare_total_loss_insurer_response_upload('b2000000-0000-4000-8000-000000000001',
  'd6000000-0000-4000-8000-000000000001','response.pdf','application/pdf',100,repeat('f',64),
  (select (payload ->> 'workflowRevision')::bigint from scenario where name='sent'))$$,
  '55000',null,'no next-response upload permit is created after follow-up sent');
reset role;
select is((select count(*)::integer from public.total_loss_communications where case_id='b2000000-0000-4000-8000-000000000001' and direction='outbound' and status='confirmed'),2,
  'one initial and one distinct follow-up outbound communication exist');
select is((select count(*)::integer from public.total_loss_negotiation_rounds where case_id='b2000000-0000-4000-8000-000000000001'),1,'no additional response round is created');
select is(public.total_loss_customer_message_draft_projection_internal('b2000000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000001')->>'draftId',
  'be100000-0000-4000-8000-000000000001','original request projection still resolves its own original draft after follow-up send');
select is((select message_version_id from public.total_loss_communications where id='be300000-0000-4000-8000-000000000001'),
  'be200000-0000-4000-8000-000000000001'::uuid,'original outbound version identity remains untouched');
select ok((select details ->> 'responseId'=(select payload #>> '{response,responseId}' from scenario where name='response')
  and details ->> 'decisionId'=(select payload #>> '{response,decision,decisionId}' from scenario where name='decision')
  from public.total_loss_workflow_events where event_type='follow_up.customer_reported_sent'),
  'sent event retains the exact response and Continue decision lineage');
update public.case_entitlements set status='suspended'
  where id='b8000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.get_total_loss_customer_follow_up('b2000000-0000-4000-8000-000000000001'),null::jsonb,'suspended entitlement hides even sent follow-up content');
select ok((select follow_up is null and next_task='payment_review' and customer_journey ->> 'nextState'='needs_attention' from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'follow-up projection preserves authoritative entitlement attention');
reset role;
select * from finish();
rollback;
