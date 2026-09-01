begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(32);

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values
  ('e1000000-0000-4000-8000-000000000001', 'response-owner@example.test', statement_timestamp(), false),
  ('e1000000-0000-4000-8000-000000000002', 'response-other@example.test', statement_timestamp(), false);

insert into public.appraisal_cases (id, user_id, service_type, status)
values (
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'total_loss',
  'check_complete'
);

insert into public.total_loss_case_details (
  case_id, intake_mode, vin, vehicle_year, vehicle_make, vehicle_model,
  vehicle_trim, mileage_at_loss, postal_code, date_of_loss, insurer_name,
  insurer_vehicle_valuation, intake_completed_at, analysis_input_revision,
  analysis_input_id
) values (
  'e2000000-0000-4000-8000-000000000001', 'manual',
  '1HGCM82633A004352', 2022, 'Honda', 'Accord', 'EX-L', 32000,
  '60601', '2026-08-20', 'Example Insurance', 18000,
  statement_timestamp(), 1, 'e3000000-0000-4000-8000-000000000001'
);

insert into public.total_loss_case_contacts (
  case_id, full_name, email, service_terms_version,
  service_terms_acknowledged_at, privacy_notice_version,
  privacy_notice_acknowledged_at, operational_follow_up_allowed,
  operational_follow_up_updated_at
) values (
  'e2000000-0000-4000-8000-000000000001', 'Response Customer',
  'response-owner@example.test', '2026-08-23', statement_timestamp(),
  '2026-08-23', statement_timestamp(), false, statement_timestamp()
);

insert into public.total_loss_analysis_jobs (
  id, case_id, source_details_updated_at, status, attempt_count,
  processing_token, run_id, finished_at, source_intake_mode,
  source_analysis_input_revision, source_analysis_input_id
) values (
  'e4000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001', statement_timestamp(),
  'completed', 1, gen_random_uuid(),
  'e5000000-0000-4000-8000-000000000001', statement_timestamp(),
  'manual', 1, 'e3000000-0000-4000-8000-000000000001'
);

insert into public.analysis_runs (
  id, job_id, case_id, artifact, request_digest,
  analysis_run_schema_version, analysis_version,
  discrepancy_analysis_version, comparable_scoring_version
) values (
  'e5000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'runId', 'e5000000-0000-4000-8000-000000000001',
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
  'e6000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  'e5000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001', 'manual', 1,
  'e3000000-0000-4000-8000-000000000001',
  'MATERIAL_UNDERVALUE_SIGNAL', 1800000, 2000000, 2100000, 2200000,
  'USD', '4', '4', '1', '1', '1', '1',
  jsonb_build_object('analysisRunId', 'e5000000-0000-4000-8000-000000000001'),
  jsonb_build_object('classification', 'MATERIAL_UNDERVALUE_SIGNAL'),
  repeat('2', 64)
);

insert into public.total_loss_claim_workflows (
  case_id, preliminary_snapshot_id, phase, current_task
) values (
  'e2000000-0000-4000-8000-000000000001',
  'e6000000-0000-4000-8000-000000000001',
  'review', 'awaiting_report_generation'
);

insert into public.commerce_orders (
  id, case_id, purchaser_user_id, preliminary_snapshot_id,
  product_identifier, product_version, amount_minor_units, currency,
  payment_provider, external_price_identifier, provider_livemode,
  purchaser_email, status, terms_version, refund_policy_version, paid_at
) values (
  'e7000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e6000000-0000-4000-8000-000000000001',
  'total-loss-package', '1', 9900, 'USD', 'stripe',
  'price_test_response_v1', false, 'response-owner@example.test',
  'paid', 'terms-1', 'refund-1', statement_timestamp()
);

insert into public.case_entitlements (
  id, case_id, order_id, preliminary_snapshot_id, product_identifier,
  product_version, status
) values (
  'e8000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e7000000-0000-4000-8000-000000000001',
  'e6000000-0000-4000-8000-000000000001',
  'total-loss-package', '1', 'active'
);

insert into public.total_loss_package_jobs (
  id, case_id, entitlement_id, preliminary_snapshot_id, status,
  attempt_count, processing_token, started_at, finished_at
) values (
  'e9000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e8000000-0000-4000-8000-000000000001',
  'e6000000-0000-4000-8000-000000000001',
  'ready', 1, gen_random_uuid(), statement_timestamp(), statement_timestamp()
);

update public.total_loss_claim_workflows
set current_package_job_id = 'e9000000-0000-4000-8000-000000000001',
    revision = revision + 1
where case_id = 'e2000000-0000-4000-8000-000000000001';

insert into public.total_loss_final_assessments (
  id, case_id, package_job_id, preliminary_snapshot_id,
  version_number, conclusion_code, currency,
  supported_range_low_minor_units, supported_range_median_minor_units,
  supported_range_high_minor_units, findings, limitations, reason_codes,
  preliminary_to_final_comparison, assessment, methodology_version,
  schema_version, assessment_digest
) values (
  'eb000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e9000000-0000-4000-8000-000000000001',
  'e6000000-0000-4000-8000-000000000001', 1,
  'MATERIAL_UNDERVALUE_SIGNAL', 'USD', 2000000, 2100000, 2200000,
  jsonb_build_array(), jsonb_build_array(), jsonb_build_array(),
  jsonb_build_object('materialChange', false),
  jsonb_build_object(
    'schemaVersion', '1',
    'continuationStatus', 'SUPPORTS_CONTINUATION',
    'assessmentDigest', repeat('6', 64)
  ),
  '1', '1', repeat('6', 64)
);

insert into public.total_loss_report_series (
  id, case_id, product_identifier, report_kind
) values (
  'ec000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'total-loss-package', 'valuation-evidence-package'
);

insert into public.total_loss_claim_documents (
  id, case_id, document_kind, storage_bucket_id, storage_object_name,
  original_filename, media_type, byte_size, content_digest, status, sealed_at
) values (
  'ed000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'valuation_evidence_report', 'case-deliverables',
  'cases/e2000000-0000-4000-8000-000000000001/reports/ec000000-0000-4000-8000-000000000001/versions/ee000000-0000-4000-8000-000000000001/report.pdf',
  'report.pdf', 'application/pdf', 321, repeat('8', 64),
  'ready', statement_timestamp()
);

insert into public.total_loss_report_versions (
  id, case_id, report_series_id, version_number, final_assessment_id,
  preliminary_snapshot_id, document_id, renderer_version, template_version,
  schema_version, report, report_digest, status, published_at, package_job_id
) values (
  'ee000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'ec000000-0000-4000-8000-000000000001', 1,
  'eb000000-0000-4000-8000-000000000001',
  'e6000000-0000-4000-8000-000000000001',
  'ed000000-0000-4000-8000-000000000001', '1', '1', '1',
  jsonb_build_object(
    'executiveConclusion', jsonb_build_object(
      'continuationStatus', 'SUPPORTS_CONTINUATION',
      'insurerValuation', jsonb_build_object(
        'value', jsonb_build_object(
          'minorUnits', 1800000,
          'currency', 'USD',
          'display', '$18,000.00'
        )
      ),
      'supportedAdvertisedPriceRange', jsonb_build_object(
        'median', jsonb_build_object(
          'minorUnits', 2100000,
          'currency', 'USD',
          'display', '$21,000.00'
        )
      )
    )
  ),
  repeat('7', 64), 'published', statement_timestamp(),
  'e9000000-0000-4000-8000-000000000001'
);

update public.total_loss_report_series
set current_report_version_id = 'ee000000-0000-4000-8000-000000000001',
    current_published_report_version_id = 'ee000000-0000-4000-8000-000000000001'
where id = 'ec000000-0000-4000-8000-000000000001';

insert into public.total_loss_negotiation_rounds (
  id, case_id, round_number, status
) values (
  'ef000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  1, 'waiting_for_insurer'
);

update public.total_loss_claim_workflows
set phase = 'negotiation',
    current_task = 'awaiting_insurer_response',
    current_report_version_id = 'ee000000-0000-4000-8000-000000000001',
    current_negotiation_round_id = 'ef000000-0000-4000-8000-000000000001',
    revision = revision + 1
where case_id = 'e2000000-0000-4000-8000-000000000001';

select ok(
  has_function_privilege(
    'authenticated',
    'public.prepare_total_loss_insurer_response_upload(uuid,uuid,text,text,bigint,text,bigint)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.record_total_loss_insurer_response(uuid,uuid,text,bigint,uuid,uuid,uuid,bigint)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.record_total_loss_insurer_response(uuid,uuid,text,bigint,uuid,uuid,uuid,bigint)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.record_total_loss_insurer_response(uuid,uuid,text,bigint,uuid,uuid,uuid,bigint)',
    'EXECUTE'
  ),
  'only authenticated customers receive the insurer-response RPC surface'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$
    select public.prepare_total_loss_insurer_response_upload(
      'e2000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000001',
      'too-large.pdf', 'application/pdf', 10485761, repeat('0', 64), 3
    )
  $$,
  '22023',
  'Insurer-response upload metadata is invalid.',
  'response uploads are capped at ten MiB'
);

create temporary table failed_upload_prepare on commit drop as
select public.prepare_total_loss_insurer_response_upload(
  'e2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'insurer-letter.pdf', 'application/pdf', 321, repeat('a', 64), 3
) as response;

select ok(
  (
    select response = jsonb_build_object(
      'documentId', 'a1000000-0000-4000-8000-000000000001'::uuid,
      'uploadPath', 'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-000000000001/insurer-responses/a1000000-0000-4000-8000-000000000001.pdf',
      'originalFilename', 'insurer-letter.pdf',
      'mediaType', 'application/pdf',
      'byteSize', 321,
      'contentDigest', repeat('a', 64)
    )
    from failed_upload_prepare
  ),
  'prepare returns an exact owner namespace permit and creates one pending document'
);

select is(
  public.prepare_total_loss_insurer_response_upload(
    'e2000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'insurer-letter.pdf', 'application/pdf', 321, repeat('a', 64), 1
  ),
  (select response from failed_upload_prepare),
  'prepare replays before applying a stale workflow revision fence'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, metadata, user_metadata)
    values (
      'case-files',
      'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-000000000001/insurer-responses/a1000000-0000-4000-8000-000000000001.pdf',
      jsonb_build_object('mimetype', 'application/pdf', 'size', 321),
      jsonb_build_object(
        'clientRequestId', 'a1000000-0000-4000-8000-000000000001',
        'originalName', 'insurer-letter.pdf',
        'contentDigest', repeat('b', 64)
      )
    )
  $$,
  '42501',
  null,
  'storage rejects metadata that differs from the exact pending permit'
);

select throws_ok(
  $$
    select public.record_total_loss_insurer_response(
      'e2000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',
      null, null,
      'a1000000-0000-4000-8000-000000000001',
      null, null, 3
    )
  $$,
  '55000',
  'The insurer-response upload is incomplete or does not match its permit.',
  'recording rejects a prepared upload whose object never completed'
);

select throws_ok(
  $$
    select public.record_total_loss_insurer_response(
      'e2000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000002',
      E'\t\n\r', null, null, null, null, 3
    )
  $$,
  '22023',
  'Insurer response content is invalid.',
  'recording rejects multiline whitespace without response material'
);

select throws_ok(
  $$
    select public.record_total_loss_insurer_response(
      'e2000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000003',
      E'\v\f', 100, null, null, null, 3
    )
  $$,
  '22023',
  'Insurer response content is invalid.',
  'recording rejects vertical-tab and form-feed controls even when an offer is present'
);

select throws_ok(
  $$
    select public.record_total_loss_insurer_response(
      'e2000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000004',
      'Offer supplied', 9007199254740992, null, null, null, 3
    )
  $$,
  '22023',
  'Insurer response content is invalid.',
  'recording rejects revised offers outside the shared JSON safe-integer boundary'
);

reset role;
select ok(
  (
    select current_task = 'awaiting_insurer_response' and revision = 3
    from public.total_loss_claim_workflows
    where case_id = 'e2000000-0000-4000-8000-000000000001'
  )
  and (
    select status = 'waiting_for_insurer'
    from public.total_loss_negotiation_rounds
    where id = 'ef000000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from public.total_loss_communications
    where case_id = 'e2000000-0000-4000-8000-000000000001'
      and communication_type = 'insurer_response'
  )
  and (
    select status = 'pending' and created_by_user_id =
      'e1000000-0000-4000-8000-000000000001'::uuid
    from public.total_loss_claim_documents
    where id = 'a1000000-0000-4000-8000-000000000001'
  ),
  'a failed upload leaves the durable workflow waiting and creates no response'
);

delete from public.total_loss_claim_documents
where id = 'a1000000-0000-4000-8000-000000000001';
set local role authenticated;

create temporary table initial_response on commit drop as
select public.record_total_loss_insurer_response(
  'e2000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  '  The insurer declined the request.  ',
  null, null, null, null, 3
) as response;

select ok(
  (
    select response ->> 'state' = 'insurer_response_received'
      and response #>> '{response,clientRequestId}' =
        'a2000000-0000-4000-8000-000000000001'
      and response #>> '{response,sourceType}' = 'pasted_message'
      and response #>> '{response,text}' = '  The insurer declined the request.  '
      and response #>> '{response,processingState}' = 'not_started'
      and response #> '{response,document}' = 'null'::jsonb
      and response #> '{response,revisedOffer}' = 'null'::jsonb
      and (response ->> 'workflowRevision')::bigint = 4
    from initial_response
  ),
  'text-only intake returns the exact unprocessed response projection without an offer'
);

reset role;
select ok(
  (
    select current_task = 'insurer_response_received'
      and phase = 'negotiation'
      and revision = 4
    from public.total_loss_claim_workflows
    where case_id = 'e2000000-0000-4000-8000-000000000001'
  )
  and (
    select status = 'response_received' and revision = 2
    from public.total_loss_negotiation_rounds
    where id = 'ef000000-0000-4000-8000-000000000001'
  )
  and (
    select count(*) = 1 and bool_and(status = 'confirmed')
    from public.total_loss_communications
    where case_id = 'e2000000-0000-4000-8000-000000000001'
      and communication_type = 'insurer_response'
  )
  and (
    select details ->> 'requestDigest' ~ '^[0-9a-f]{64}$'
    from public.total_loss_workflow_events
    where case_id = 'e2000000-0000-4000-8000-000000000001'
      and client_request_id = 'a2000000-0000-4000-8000-000000000001'
  ),
  'text intake atomically confirms communication, advances round and workflow, and records a digest event'
);

set local role authenticated;
select is(
  public.record_total_loss_insurer_response(
    'e2000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    '  The insurer declined the request.  ',
    null, null, null, null, 3
  ) #>> '{response,responseId}',
  (select response #>> '{response,responseId}' from initial_response),
  'an identical finalization replays before applying a stale revision fence'
);

select throws_ok(
  $$
    select public.record_total_loss_insurer_response(
      'e2000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000001',
      'Changed payload', null, null, null, null, 3
    )
  $$,
  '55000',
  'Client request identity was already used.',
  'the same client request identity rejects a different normalized payload'
);

create temporary table correction_prepare on commit drop as
select public.prepare_total_loss_insurer_response_upload(
  'e2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'revised-offer.pdf', 'application/pdf', 654, repeat('c', 64), 4
) as response;

select ok(
  (
    select response ->> 'uploadPath' =
      'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-000000000001/insurer-responses/a3000000-0000-4000-8000-000000000001.pdf'
      and response ->> 'documentId' = 'a3000000-0000-4000-8000-000000000001'
    from correction_prepare
  ),
  'a correction can prepare one new attachment while the response remains unprocessed'
);

select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, metadata, user_metadata)
    values (
      'case-files',
      'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-000000000001/insurer-responses/a3000000-0000-4000-8000-000000000001.pdf',
      jsonb_build_object('mimetype', 'application/pdf', 'size', 654),
      jsonb_build_object(
        'clientRequestId', 'a3000000-0000-4000-8000-000000000001',
        'originalName', 'revised-offer.pdf',
        'contentDigest', repeat('c', 64)
      )
    )
  $$,
  'the exact pending row, path, object metadata, and user metadata authorize one upload'
);

create temporary table uploaded_correction on commit drop as
select public.record_total_loss_insurer_response(
  'e2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'The insurer supplied a revised written offer.',
  1950000,
  'a3000000-0000-4000-8000-000000000001',
  null,
  (select (response #>> '{response,responseId}')::uuid from initial_response),
  4
) as response;

select ok(
  (
    select response #>> '{response,sourceType}' = 'uploaded_document'
      and response #>> '{response,document,documentId}' =
        'a3000000-0000-4000-8000-000000000001'
      and response #>> '{response,document,originalFilename}' = 'revised-offer.pdf'
      and (response #>> '{response,document,byteSize}')::bigint = 654
      and (response #>> '{response,revisedOffer,amountMinorUnits}')::bigint = 1950000
      and response #>> '{response,revisedOffer,currency}' = 'USD'
      and response #>> '{response,supersedesResponseId}' =
        (select response #>> '{response,responseId}' from initial_response)
    from uploaded_correction
  ),
  'an uploaded correction returns its sealed document, report-derived USD offer, and response lineage'
);

reset role;
select ok(
  (
    select status = 'ready' and sealed_at is not null
    from public.total_loss_claim_documents
    where id = 'a3000000-0000-4000-8000-000000000001'
  )
  and (
    select count(*) = 2
    from public.total_loss_communications
    where case_id = 'e2000000-0000-4000-8000-000000000001'
      and communication_type = 'insurer_response'
  )
  and (
    select amount_minor_units = 1950000 and currency = 'USD'
      and status = 'recorded'
    from public.total_loss_offers
    where case_id = 'e2000000-0000-4000-8000-000000000001'
  )
  and (
    select current_task = 'insurer_response_received' and revision = 5
    from public.total_loss_claim_workflows
    where case_id = 'e2000000-0000-4000-8000-000000000001'
  ),
  'uploaded correction seals the document and preserves both response versions with one current offer'
);

set local role authenticated;
create temporary table response_update_attempt on commit drop as
with changed as (
  update storage.objects
  set user_metadata = user_metadata
  where bucket_id = 'case-files'
    and name like '%/a3000000-0000-4000-8000-000000000001.pdf'
  returning 1
)
select count(*) as changed_count from changed;

select is(
  (select changed_count from response_update_attempt),
  0::bigint,
  'response objects cannot be updated after upload'
);

set local storage.allow_delete_query = 'true';
create temporary table response_delete_attempt on commit drop as
with removed as (
  delete from storage.objects
  where bucket_id = 'case-files'
    and name like '%/a3000000-0000-4000-8000-000000000001.pdf'
  returning 1
)
select count(*) as removed_count from removed;

select is(
  (select removed_count from response_delete_attempt),
  0::bigint,
  'a ready insurer-response object cannot be deleted'
);

select ok(
  (
    select workflow_current_task = 'insurer_response_received'
      and customer_journey ->> 'nextState' = 'insurer_response_received'
      and customer_journey ->> 'fulfillmentState' = 'insurer_response_received'
      and insurer_response = (
        select response -> 'response' from uploaded_correction
      )
      and insurer_response ?& array[
        'responseId', 'clientRequestId', 'receivedAt', 'sourceType', 'text',
        'document', 'revisedOffer', 'processingState', 'supersedesResponseId'
      ]
      and (
        select count(*) = 9
        from jsonb_object_keys(insurer_response)
      )
      and not (insurer_response -> 'document' ? 'uploadPath')
      and not (insurer_response -> 'document' ? 'contentDigest')
      and not (insurer_response -> 'revisedOffer' ? 'offerId')
    from public.resolve_total_loss_case_claim(
      'e2000000-0000-4000-8000-000000000001'
    )
  ),
  'the secured resolver exposes only the exact current owner-safe response projection and journey state'
);

create temporary table retained_correction on commit drop as
select public.record_total_loss_insurer_response(
  'e2000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  'Clarification: no revised offer was made.',
  null,
  null,
  'a3000000-0000-4000-8000-000000000001',
  (select (response #>> '{response,responseId}')::uuid from uploaded_correction),
  5
) as response;

select ok(
  (
    select response #>> '{response,clientRequestId}' =
        'a4000000-0000-4000-8000-000000000001'
      and response #>> '{response,sourceType}' = 'uploaded_document'
      and response #>> '{response,document,documentId}' =
        'a3000000-0000-4000-8000-000000000001'
      and response #> '{response,revisedOffer}' = 'null'::jsonb
      and response #>> '{response,supersedesResponseId}' =
        (select response #>> '{response,responseId}' from uploaded_correction)
      and (response ->> 'workflowRevision')::bigint = 6
    from retained_correction
  ),
  'a later correction can retain the prior ready document while removing a wrongly recorded offer'
);

reset role;
select ok(
  (
    select count(*) = 3
    from public.total_loss_communications
    where case_id = 'e2000000-0000-4000-8000-000000000001'
      and communication_type = 'insurer_response'
  )
  and (
    select count(*) = 2
    from public.total_loss_communication_documents
    where case_id = 'e2000000-0000-4000-8000-000000000001'
      and document_id = 'a3000000-0000-4000-8000-000000000001'
  )
  and (
    select count(*) = 1 and bool_and(status = 'superseded')
    from public.total_loss_offers
    where case_id = 'e2000000-0000-4000-8000-000000000001'
  )
  and (
    select count(*) = 1 and bool_and(status = 'ready')
    from public.total_loss_claim_documents
    where case_id = 'e2000000-0000-4000-8000-000000000001'
      and document_kind = 'insurer_response'
  ),
  'correction history retains all communications, attachment evidence, and the superseded offer fact'
);

set local role authenticated;
select ok(
  (
    select insurer_response = (
      select response -> 'response' from retained_correction
    )
      and insurer_response #>> '{clientRequestId}' =
        'a4000000-0000-4000-8000-000000000001'
      and workflow_revision = 6
    from public.resolve_total_loss_case_claim(
      'e2000000-0000-4000-8000-000000000001'
    )
  ),
  'the resolver selects the unsuperseded correction rather than stale response material'
);

select ok(
  (
    select response = (select response from initial_response)
      and (response ->> 'workflowRevision')::bigint = 4
    from (
      select public.record_total_loss_insurer_response(
        'e2000000-0000-4000-8000-000000000001',
        'a2000000-0000-4000-8000-000000000001',
        '  The insurer declined the request.  ',
        null, null, null, null, 3
      ) as response
    ) as replay
  ),
  'an older accepted request replays its original workflow revision after later corrections'
);

create temporary table bounded_pending_prepares (
  response jsonb
) on commit drop;

insert into bounded_pending_prepares
select public.prepare_total_loss_insurer_response_upload(
  'e2000000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001',
  'pending-1.pdf', 'application/pdf', 10485760, repeat('d', 64), 6
);
insert into bounded_pending_prepares
select public.prepare_total_loss_insurer_response_upload(
  'e2000000-0000-4000-8000-000000000001',
  'a7000000-0000-4000-8000-000000000001',
  'pending-2.pdf', 'application/pdf', 10, repeat('d', 64), 6
);
insert into bounded_pending_prepares
select public.prepare_total_loss_insurer_response_upload(
  'e2000000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000001',
  'pending-3.pdf', 'application/pdf', 10, repeat('d', 64), 6
);
insert into bounded_pending_prepares
select public.prepare_total_loss_insurer_response_upload(
  'e2000000-0000-4000-8000-000000000001',
  'a9000000-0000-4000-8000-000000000001',
  'pending-4.pdf', 'application/pdf', 10, repeat('d', 64), 6
);
insert into bounded_pending_prepares
select public.prepare_total_loss_insurer_response_upload(
  'e2000000-0000-4000-8000-000000000001',
  'aa000000-0000-4000-8000-000000000001',
  'pending-5.pdf', 'application/pdf', 10, repeat('d', 64), 6
);

select throws_ok(
  $$
    select public.prepare_total_loss_insurer_response_upload(
      'e2000000-0000-4000-8000-000000000001',
      'ab000000-0000-4000-8000-000000000001',
      'pending-6.pdf', 'application/pdf', 10, repeat('d', 64), 6
    )
  $$,
  '55000',
  'Too many insurer-response uploads are incomplete.',
  'a case owner cannot reserve unbounded incomplete response upload paths'
);

reset role;
select ok(
  (
    select count(*) = 5
      and count(*) filter (
        where (response ->> 'byteSize')::bigint = 10485760
      ) = 1
    from bounded_pending_prepares
  )
  and (
    select count(*) = 5
    from public.total_loss_claim_documents
    where case_id = 'e2000000-0000-4000-8000-000000000001'
      and document_kind = 'insurer_response'
      and status = 'pending'
  ),
  'the exact ten MiB boundary is accepted while the case remains capped at five pending permits'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$
    select public.prepare_total_loss_insurer_response_upload(
      'e2000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'other.pdf', 'application/pdf', 10, repeat('d', 64), 6
    )
  $$,
  '42501',
  'Insurer-response upload is unavailable.',
  'another authenticated account cannot prepare an owner response upload'
);

select throws_ok(
  $$
    select public.record_total_loss_insurer_response(
      'e2000000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      'Unauthorized response', null, null, null,
      (select (response #>> '{response,responseId}')::uuid from retained_correction),
      6
    )
  $$,
  '42501',
  'Insurer response recording is unavailable.',
  'another authenticated account cannot append a correction'
);

select is_empty(
  $$
    select * from public.resolve_total_loss_case_claim(
      'e2000000-0000-4000-8000-000000000001'
    )
  $$,
  'another account cannot resolve the owner case or response identity'
);

select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'case-files'
      and name like '%/a3000000-0000-4000-8000-000000000001.pdf'
  ),
  0::bigint,
  'another account cannot read the owner response object'
);

reset role;
update auth.users
set email = 'mismatch@example.test'
where id = 'e1000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);

select ok(
  (
    select state = 'account_mismatch'
      and contact_email is null
      and insurer_response is null
      and customer_journey ->> 'nextState' = 'secure_claim'
    from public.resolve_total_loss_case_claim(
      'e2000000-0000-4000-8000-000000000001'
    )
  ),
  'account-mismatch recovery remains neutral and withholds response identity and saved email'
);

select * from finish();
rollback;
