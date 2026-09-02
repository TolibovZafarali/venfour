begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(54);

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
  'be000000-0000-4000-8000-000000000001',
  'bd000000-0000-4000-8000-000000000001',
  'initial-reconsideration-request', 'adjuster@example.test',
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
  1, 'customer_reported_sent', 'initial-reconsideration-request',
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

select ok(
  has_function_privilege('service_role','public.complete_total_loss_response_analysis_with_recommendation(uuid,uuid,uuid,text,text,jsonb,text,jsonb,text,jsonb,text,text,jsonb,text,jsonb,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.publish_total_loss_insurer_response_recommendation(uuid,jsonb,text)','EXECUTE')
  and not has_function_privilege('anon','public.resolve_current_total_loss_response_recommendation_context(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.record_total_loss_insurer_response_decision(uuid,uuid,uuid,uuid,text,uuid,bigint)','EXECUTE')
  and not has_function_privilege('service_role','public.record_total_loss_insurer_response_decision(uuid,uuid,uuid,uuid,text,uuid,bigint)','EXECUTE')
  and not has_table_privilege('authenticated','public.total_loss_insurer_response_decisions','SELECT'),
  'recommendation writes are service-only, explicit decisions are owner RPC-only, raw decisions remain private');

update valid_result set result=jsonb_set(result,'{revisedOffer}',jsonb_build_object(
  'status','PRESENT','amountMinorUnits',2050000,'currency','USD','source','INSURER_RESPONSE',
  'responseEvidenceRefs',jsonb_build_array('response_'||repeat('a',64)),'visualSourceInterpretation',null));
update valid_evidence_index set evidence_index=jsonb_set(evidence_index,'{responseEvidence,0,content}',
  to_jsonb('Our revised valuation is $20,500.00.'::text));
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
insert into scenario values('first',public.record_total_loss_insurer_response(
  'b2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',
  'Our revised valuation is $20,500.00.',2050000,null,null,null,3));
select ok((select payload #> '{response,recommendation}'='null'::jsonb
  and payload #> '{response,usableOffer}'='null'::jsonb and payload #> '{response,decision}'='null'::jsonb
  from scenario where name='first'),'pending response always projects nullable recommendation, offer, and decision');
reset role;

select throws_ok($$select pg_temp.complete_response(jsonb_set(pg_temp.recommendation('CONTINUE_CHALLENGING'),
  '{policyInput,assessmentDigest}',to_jsonb(repeat('0',64))))$$,
  '22023','Recommendation evidence does not match its saved sources.',
  'atomic completion rejects a recommendation from different saved evidence');
select is((select count(*) from public.total_loss_insurer_response_analysis_results where case_id='b2000000-0000-4000-8000-000000000001'),0::bigint,
  'failed recommendation persistence rolls back the analysis completion');
select throws_ok($$select pg_temp.complete_response(jsonb_set(pg_temp.recommendation('CONTINUE_CHALLENGING'),
  '{responseEvidenceRefs}',jsonb_build_array('response_'||repeat('f',64))))$$,
  '22023','Recommendation evidence does not match its saved sources.',
  'recommendation cannot cite evidence absent from the saved analysis index');
select throws_ok($$select pg_temp.complete_response(jsonb_set(pg_temp.recommendation('CONTINUE_CHALLENGING'),
  '{offer,amountMinorUnits}','2200000'::jsonb))$$,'22023',
  'Recommendation offer does not match the analyzed response.',
  'recommendation cannot change the source response offer amount');
select throws_ok($$select pg_temp.complete_response(pg_temp.recommendation('ACCEPT_OFFER'))$$,
  '22023','Response recommendation is invalid.',
  'the current assessment policy cannot publish an unsupported Accept recommendation');
select throws_ok($$select pg_temp.complete_response(jsonb_set(pg_temp.recommendation('NO_CLEAR_RECOMMENDATION'),
  '{policyVersion}','"1"'::jsonb))$$,'22023','New response recommendations require the current assessment policy.',
  'new recommendations cannot use the superseded policy');
select throws_ok($$select pg_temp.complete_response(jsonb_set(pg_temp.recommendation('NO_CLEAR_RECOMMENDATION'),
  '{policyInput,insurerValuationReviewed}','{"valueMinorUnits":2050000,"currency":"USD"}'::jsonb))$$,
  '22023','Recommendation evidence does not match its saved sources.',
  'recommendation cannot replace the insurer value evaluated by its saved assessment');
select throws_ok($$select pg_temp.complete_response(jsonb_set(pg_temp.recommendation('NO_CLEAR_RECOMMENDATION'),
  '{policyInput,limitations}','[{"code":"UNSAVED_LIMITATION"}]'::jsonb))$$,
  '22023','Recommendation evidence does not match its saved sources.',
  'recommendation limitations must match the immutable assessment');
select throws_ok($$select pg_temp.complete_response(jsonb_set(pg_temp.recommendation('NO_CLEAR_RECOMMENDATION'),
  '{policyInput,assumptions}','[{"code":"UNSAVED_ASSUMPTION"}]'::jsonb))$$,
  '22023','Recommendation evidence does not match its saved sources.',
  'recommendation assumptions must match the immutable assessment');
select is(pg_temp.complete_response(pg_temp.recommendation('CONTINUE_CHALLENGING')) ->> 'outcome','completed',
  'one transaction completes the analysis and publishes its recommendation');
set local role authenticated;
insert into scenario select 'current',jsonb_build_object('response',insurer_response,'workflowRevision',workflow_revision)
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001');
select ok((select payload #>> '{response,recommendation,state}'='CONTINUE_CHALLENGING'
  and payload #>> '{response,usableOffer,amountMinorUnits}'='2050000'
  and payload #>> '{response,usableOffer,source}'='CUSTOMER_RECORDED'
  and payload #> '{response,decision}'='null'::jsonb
  and not (payload #> '{response,recommendation}' ? 'policyInput')
  from scenario where name='current'),'reviewed response exposes persisted recommendation and exact offer without internal policy inputs');
select is((select insurer_response from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  (select payload->'response' from scenario where name='current'),'refresh returns the same stored recommendation and no decision');
reset role;
select is((select count(*) from public.total_loss_insurer_response_decisions where case_id='b2000000-0000-4000-8000-000000000001'),0::bigint,
  'viewing the response never creates a decision');
select ok((select source_analysis_result_id is not null and source_report_version_id='bd000000-0000-4000-8000-000000000001'
  and source_assessment_digest=repeat('6',64) and recommendation_digest=public.total_loss_canonical_jsonb_digest(recommendation)
  from public.total_loss_recommendations where case_id='b2000000-0000-4000-8000-000000000001'),'recommendation preserves exact analysis, report, assessment and payload digests');
select is((select public.publish_total_loss_insurer_response_recommendation(source_analysis_result_id,recommendation,recommendation_digest)->>'outcome'
  from public.total_loss_recommendations where case_id='b2000000-0000-4000-8000-000000000001'),'duplicate','exact recommendation publication retry is idempotent');
select throws_ok($$update public.total_loss_recommendations set recommendation='{}' where case_id='b2000000-0000-4000-8000-000000000001'$$,'55000',
  null,'published recommendation cannot be changed');
select ok((select count(*)=1 and bool_and(status='recorded') from public.total_loss_offers where case_id='b2000000-0000-4000-8000-000000000001'),
  'the exact customer-entered offer is reused without changing its recorded status');

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001',
  (select (payload #>> '{response,responseId}')::uuid from scenario where name='current'),
  (select (payload #>> '{response,recommendation,recommendationId}')::uuid from scenario where name='current'),
  'CONTINUE_CHALLENGING',null,(select (payload->>'workflowRevision')::bigint from scenario where name='current'))$$,
  '42501','Response decision is unavailable.','another account cannot record a choice');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002',
  (select (payload #>> '{response,responseId}')::uuid from scenario where name='current'),
  (select (payload #>> '{response,recommendation,recommendationId}')::uuid from scenario where name='current'),
  'ACCEPT_OFFER','d9000000-0000-4000-8000-000000000001',
  (select (payload->>'workflowRevision')::bigint from scenario where name='current'))$$,
  '22023','The selected offer does not match this analyzed response.','Accept cannot bind a different offer identity');
select throws_ok($$select public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000003',
  (select (payload #>> '{response,responseId}')::uuid from scenario where name='current'),
  (select (payload #>> '{response,recommendation,recommendationId}')::uuid from scenario where name='current'),
  'CONTINUE_CHALLENGING',null,1)$$,'40001','Claim workflow changed before the response decision.',
  'new decisions reject a stale workflow revision');
insert into scenario select 'accepted',public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000004',
  (payload #>> '{response,responseId}')::uuid,(payload #>> '{response,recommendation,recommendationId}')::uuid,
  'ACCEPT_OFFER',(payload #>> '{response,usableOffer,offerId}')::uuid,(payload->>'workflowRevision')::bigint)
  from scenario where name='current';
select ok((select payload #>> '{response,decision,choice}'='ACCEPT_OFFER'
  and payload #>> '{response,decision,offerId}'=payload #>> '{response,usableOffer,offerId}'
  and payload #>> '{response,decision,amountMinorUnits}'='2050000'
  and payload #>> '{response,decision,recommendationId}'=payload #>> '{response,recommendation,recommendationId}'
  from scenario where name='accepted'),'Accept records the explicit choice and exact immutable offer amount/version');
select ok(public.get_total_loss_customer_follow_up('b2000000-0000-4000-8000-000000000001') is null
  and (select next_task='insurer_response_reviewed' and follow_up is null from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'Accept does not expose or generate a follow-up request');
reset role;
select ok((select
    projected #>> '{recommendation,state}' = 'NO_CLEAR_RECOMMENDATION'
    and (projected - 'recommendation') = ((payload -> 'response') - 'recommendation')
    and projected #>> '{recommendation,recommendationId}' = payload #>> '{response,recommendation,recommendationId}'
    and projected #>> '{recommendation,analysisResultId}' = payload #>> '{response,recommendation,analysisResultId}'
    and projected #>> '{recommendation,versionNumber}' = payload #>> '{response,recommendation,versionNumber}'
    and projected #>> '{recommendation,policyVersion}' = '1'
    and projected #>> '{decision,choice}' = 'ACCEPT_OFFER'
  from scenario cross join lateral (
    select public.total_loss_response_recommendation_current_projection(
      jsonb_set(jsonb_set(payload -> 'response','{recommendation,policyVersion}','"1"'::jsonb),
        '{recommendation,state}','"ACCEPT_OFFER"'::jsonb)) as projected
  ) as prior_policy where name='accepted'),
  'prior policy direction is withheld while exact offer, source identifiers and explicit Accept choice survive unchanged');
set local role authenticated;
select is((select public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000004',
  (payload #>> '{response,responseId}')::uuid,(payload #>> '{response,recommendation,recommendationId}')::uuid,
  'ACCEPT_OFFER',(payload #>> '{response,usableOffer,offerId}')::uuid,1) from scenario where name='current'),
  (select payload from scenario where name='accepted'),'exact Accept retry replays after the old revision fence');
select throws_ok($$select public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000004',
  (select (payload #>> '{response,responseId}')::uuid from scenario where name='current'),
  (select (payload #>> '{response,recommendation,recommendationId}')::uuid from scenario where name='current'),
  'CONTINUE_CHALLENGING',null,1)$$,'55000','Client request identity was already used.',
  'reusing a decision request identity for the opposite choice is rejected');
select throws_ok($$select public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000005',
  (select (payload #>> '{response,responseId}')::uuid from scenario where name='accepted'),
  (select (payload #>> '{response,recommendation,recommendationId}')::uuid from scenario where name='accepted'),
  'CONTINUE_CHALLENGING',null,(select (payload->>'workflowRevision')::bigint from scenario where name='accepted'))$$,
  '55000','A decision is already recorded for this analyzed response.','a new request cannot overwrite the first explicit decision');
reset role;
select ok((select current_task='insurer_response_received' and resolved_at is null from public.total_loss_claim_workflows where case_id='b2000000-0000-4000-8000-000000000001')
  and (select status='response_received' from public.total_loss_negotiation_rounds where case_id='b2000000-0000-4000-8000-000000000001')
  and (select status='recorded' from public.total_loss_offers where case_id='b2000000-0000-4000-8000-000000000001'),'Accept neither closes the case nor resolves the offer or round');
select throws_ok($$delete from public.total_loss_insurer_response_decisions where case_id='b2000000-0000-4000-8000-000000000001'$$,'55000',null,
  'recorded customer decisions are immutable');
update public.case_entitlements set status='suspended',reason_code='LOCAL_REVIEW',status_changed_at=statement_timestamp() where case_id='b2000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000004',
  (select (payload #>> '{response,responseId}')::uuid from scenario where name='current'),
  (select (payload #>> '{response,recommendation,recommendationId}')::uuid from scenario where name='current'),
  'ACCEPT_OFFER',(select (payload #>> '{response,usableOffer,offerId}')::uuid from scenario where name='current'),1)$$,
  '42501','Response decision is unavailable.','suspended entitlement blocks even an exact decision replay');
reset role;
update public.case_entitlements set status='active',reason_code=null,status_changed_at=statement_timestamp() where case_id='b2000000-0000-4000-8000-000000000001';
set local role authenticated;
insert into scenario select 'correction',public.record_total_loss_insurer_response(
  'b2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002',
  'Corrected response: Our revised valuation is $20,500.00.',null,null,null,
  (payload #>> '{response,responseId}')::uuid,(payload->>'workflowRevision')::bigint)
  from scenario where name='accepted';
select ok((select payload #> '{response,recommendation}'='null'::jsonb and payload #> '{response,decision}'='null'::jsonb
  from scenario where name='correction'),'a correction begins without inheriting the old recommendation or decision');
reset role;
select is((select current_recommendation_id from public.total_loss_claim_workflows where case_id='b2000000-0000-4000-8000-000000000001'),null::uuid,
  'correction clears the authoritative current recommendation pointer');
select ok((select count(*)=1 from public.total_loss_insurer_response_decisions where case_id='b2000000-0000-4000-8000-000000000001')
  and (select status='superseded' from public.total_loss_offers where case_id='b2000000-0000-4000-8000-000000000001'),'old accepted-choice history survives while its old offer is superseded');
set local role authenticated;
select throws_ok($$select public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000004',
  (select (payload #>> '{response,responseId}')::uuid from scenario where name='current'),
  (select (payload #>> '{response,recommendation,recommendationId}')::uuid from scenario where name='current'),
  'ACCEPT_OFFER',(select (payload #>> '{response,usableOffer,offerId}')::uuid from scenario where name='current'),1)$$,
  '40001','Claim workflow changed before the response decision.',
  'old exact decision retries cannot replace a corrected current response projection');
reset role;
update valid_result set result=jsonb_set(result,'{revisedOffer,visualSourceInterpretation}',
  jsonb_build_object('derivation','MODEL_VISUAL_TRANSCRIPTION','verificationRequired',true));
select throws_ok($$select pg_temp.complete_response(pg_temp.recommendation('NO_CLEAR_RECOMMENDATION','RESPONSE_TEXT'))$$,
  '22023','Response text cannot replace an existing or unverified offer.',
  'unverified visual transcription cannot materialize an offer for acceptance');
update valid_result set result=jsonb_set(result,'{revisedOffer,visualSourceInterpretation}','null');
update valid_result set result=jsonb_set(result,'{revisedOffer,currency}','"EUR"');
select throws_ok($$select pg_temp.complete_response(jsonb_set(pg_temp.recommendation('NO_CLEAR_RECOMMENDATION','RESPONSE_TEXT'),
  '{offer,currency}','"EUR"'))$$,'22023','Response text cannot replace an existing or unverified offer.',
  'USD text cannot create an exact offer in a different currency');
update valid_result set result=jsonb_set(result,'{revisedOffer,currency}','"USD"');
update valid_evidence_index set evidence_index=jsonb_set(evidence_index,'{responseEvidence,0,content}',
  to_jsonb('The revised amount is not stated.'::text));
select throws_ok($$select pg_temp.complete_response(pg_temp.recommendation('NO_CLEAR_RECOMMENDATION','RESPONSE_TEXT'))$$,
  '22023','Response offer lacks literal saved text evidence.',
  'a generated amount without matching literal saved response text is rejected');
update valid_evidence_index set evidence_index=jsonb_set(evidence_index,'{responseEvidence,0,content}',
  to_jsonb('Our revised valuation is $20,500.00.'::text));
select is(pg_temp.complete_response(pg_temp.recommendation('NO_CLEAR_RECOMMENDATION','RESPONSE_TEXT'))->>'outcome','completed',
  'literal response text can publish and materialize an exact new stored offer');
select ok((select count(*)=2 from public.total_loss_offers where case_id='b2000000-0000-4000-8000-000000000001')
  and (select supersedes_offer_id is not null from public.total_loss_offers
    where case_id='b2000000-0000-4000-8000-000000000001' and status='recorded')
  and (select source_offer_id is not null and supersedes_recommendation_id is not null
    from public.total_loss_recommendations where version_number=2 and case_id='b2000000-0000-4000-8000-000000000001'),'corrected recommendation has coherent lineage and a distinct offer identity');
set local role authenticated;
insert into scenario select 'corrected_review',jsonb_build_object('response',insurer_response,'workflowRevision',workflow_revision)
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001');
select throws_ok($$select public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000006',
  (select (payload #>> '{response,responseId}')::uuid from scenario where name='current'),
  (select (payload #>> '{response,recommendation,recommendationId}')::uuid from scenario where name='current'),
  'CONTINUE_CHALLENGING',null,(select (payload->>'workflowRevision')::bigint from scenario where name='corrected_review'))$$,
  '40001','Claim workflow changed before the response decision.','old recommendation cannot receive a new choice after corrected evidence is reviewed');
insert into scenario select 'continued',public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000007',
  (payload #>> '{response,responseId}')::uuid,(payload #>> '{response,recommendation,recommendationId}')::uuid,
  'CONTINUE_CHALLENGING',null,(payload->>'workflowRevision')::bigint)
  from scenario where name='corrected_review';
select ok((select payload #>> '{response,recommendation,state}'='NO_CLEAR_RECOMMENDATION'
  and payload #>> '{response,decision,choice}'='CONTINUE_CHALLENGING'
  and payload #> '{response,decision,offerId}'='null'::jsonb and payload #> '{response,decision,amountMinorUnits}'='null'::jsonb
  from scenario where name='continued'),'customer may Continue without a clear recommendation without accepting any offer');
select is((select public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000007',
  (payload #>> '{response,responseId}')::uuid,(payload #>> '{response,recommendation,recommendationId}')::uuid,
  'CONTINUE_CHALLENGING',null,1) from scenario where name='continued'),
  (select payload from scenario where name='continued'),'explicit Continue is idempotent');
select is((select insurer_response #>> '{decision,choice}' from public.resolve_total_loss_case_claim(
  'b2000000-0000-4000-8000-000000000001')),'CONTINUE_CHALLENGING','refresh resumes the separate recorded Continue choice');
reset role;
select ok((select count(*)=2 and count(distinct recommendation_id)=2
  and count(distinct analysis_result_id)=2 from public.total_loss_insurer_response_decisions
  where case_id='b2000000-0000-4000-8000-000000000001'),
  'corrected analyses retain distinct explicit decisions without inheriting the old choice');
set local role authenticated;
insert into scenario select 'legacy',public.record_total_loss_insurer_response(
  'b2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003',
  'No revised offer is provided.',null,null,null,(payload #>> '{response,responseId}')::uuid,
  (payload->>'workflowRevision')::bigint) from scenario where name='continued';
reset role;
update valid_result set result=jsonb_set(result,'{revisedOffer}',jsonb_build_object(
  'status','ABSENT','amountMinorUnits',null,'currency',null,'source',null,
  'responseEvidenceRefs','[]'::jsonb,'visualSourceInterpretation',null));
select is(pg_temp.complete_response(null,false)->>'outcome','completed','pre-milestone completion remains compatible and immutable');
set local role authenticated;
select ok((select insurer_response #> '{recommendation}'='null'::jsonb and insurer_response #> '{usableOffer}'='null'::jsonb
  and insurer_response #> '{decision}'='null'::jsonb from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'viewing an older completed result does not synthesize recommendation or decision');
reset role;
select is((select count(*) from public.total_loss_recommendations where case_id='b2000000-0000-4000-8000-000000000001'),2::bigint,
  'legacy read leaves the persisted recommendation count unchanged');
set local role service_role;
select ok((select final_assessment='{"schemaVersion":"1"}'::jsonb and assessment_digest=repeat('6',64)
  and recommendation_id is null and customer_offer is null
  from public.resolve_current_total_loss_response_recommendation_context('b2000000-0000-4000-8000-000000000001')),
  'explicit backfill context returns the exact saved assessment and current analysis only');
reset role;
select is((select public.publish_total_loss_insurer_response_recommendation(analysis_result_id,
  pg_temp.recommendation('NO_CLEAR_RECOMMENDATION',null),public.total_loss_canonical_jsonb_digest(pg_temp.recommendation('NO_CLEAR_RECOMMENDATION',null))) ->> 'outcome'
  from public.resolve_current_total_loss_response_recommendation_context('b2000000-0000-4000-8000-000000000001')),
  'published','explicit service backfill publishes a neutral recommendation for a legacy completed result');
set local role authenticated;
insert into scenario select 'no_offer',jsonb_build_object('response',insurer_response,'workflowRevision',workflow_revision)
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001');
select ok((select payload #>> '{response,recommendation,state}'='NO_CLEAR_RECOMMENDATION'
  and payload #> '{response,usableOffer}'='null'::jsonb from scenario where name='no_offer'),
  'a no-offer recommendation never presents a usable Accept target');
select throws_ok($$select public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000008',
  (select (payload #>> '{response,responseId}')::uuid from scenario where name='no_offer'),
  (select (payload #>> '{response,recommendation,recommendationId}')::uuid from scenario where name='no_offer'),
  'ACCEPT_OFFER',null,(select (payload->>'workflowRevision')::bigint from scenario where name='no_offer'))$$,
  '22023','Response decision identity is invalid.','Accept without an exact usable offer fails closed');
select lives_ok($$select public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000009',
  (select (payload #>> '{response,responseId}')::uuid from scenario where name='no_offer'),
  (select (payload #>> '{response,recommendation,recommendationId}')::uuid from scenario where name='no_offer'),
  'CONTINUE_CHALLENGING',null,(select (payload->>'workflowRevision')::bigint from scenario where name='no_offer'))$$,
  'customer can explicitly Continue without a revised offer or clear recommendation');
reset role;
select ok((select count(*)=1 from public.total_loss_negotiation_rounds where case_id='b2000000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.total_loss_claim_workflows where resolved_at is not null and case_id='b2000000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.total_loss_message_versions where case_id='b2000000-0000-4000-8000-000000000001'),
  'decisions create neither follow-up requests, additional rounds, nor final case closure');

select * from finish();
rollback;
