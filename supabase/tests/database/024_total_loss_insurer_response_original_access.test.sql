begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

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

insert into public.total_loss_message_drafts (
  id, case_id, negotiation_round_id, report_version_id,
  purpose, recipient, subject, body
) values (
  'ef100000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'ef000000-0000-4000-8000-000000000001',
  'ee000000-0000-4000-8000-000000000001',
  'initial-reconsideration-request', 'adjuster@example.test',
  'Valuation review', 'Please review the attached valuation evidence.'
);

insert into public.total_loss_message_versions (
  id, case_id, message_draft_id, negotiation_round_id, report_version_id,
  version_number, message_state, purpose, recipient, subject, body,
  message_digest, sent_at
) values (
  'ef200000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'ef100000-0000-4000-8000-000000000001',
  'ef000000-0000-4000-8000-000000000001',
  'ee000000-0000-4000-8000-000000000001',
  1, 'customer_reported_sent', 'initial-reconsideration-request',
  'adjuster@example.test', 'Valuation review',
  'Please review the attached valuation evidence.', repeat('9', 64),
  statement_timestamp()
);

insert into public.total_loss_communications (
  id, case_id, negotiation_round_id, direction, channel,
  communication_type, status, sender, recipient, subject, original_content,
  occurred_at, confirmed_at, recorded_by_user_id, message_version_id
) values (
  'ef300000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'ef000000-0000-4000-8000-000000000001',
  'outbound', 'email', 'initial_reconsideration_request', 'confirmed',
  'response-owner@example.test', 'adjuster@example.test',
  'Valuation review', 'Please review the attached valuation evidence.',
  statement_timestamp(), statement_timestamp(),
  'e1000000-0000-4000-8000-000000000001',
  'ef200000-0000-4000-8000-000000000001'
);

update public.total_loss_negotiation_rounds
set originating_communication_id = 'ef300000-0000-4000-8000-000000000001',
    revision = revision + 1
where id = 'ef000000-0000-4000-8000-000000000001';

update public.total_loss_claim_workflows
set phase = 'negotiation',
    current_task = 'awaiting_insurer_response',
    current_report_version_id = 'ee000000-0000-4000-8000-000000000001',
    current_negotiation_round_id = 'ef000000-0000-4000-8000-000000000001',
    revision = revision + 1
where case_id = 'e2000000-0000-4000-8000-000000000001';

-- Original and correction fixtures use the same immutable document links as the
-- recording RPC, without running response analysis in this authorization test.
insert into public.total_loss_claim_documents (
  id, case_id, document_kind, storage_bucket_id, storage_object_name,
  original_filename, media_type, byte_size, content_digest, status, sealed_at
)
select
  ('a1000000-0000-4000-8000-' || lpad(item::text, 12, '0'))::uuid,
  'e2000000-0000-4000-8000-000000000001', 'insurer_response', 'case-files',
  'e1000000-0000-4000-8000-000000000001/e2000000-0000-4000-8000-000000000001/insurer-responses/a1000000-0000-4000-8000-' || lpad(item::text, 12, '0') || '.pdf',
  'Insurer letter.pdf', 'application/pdf', 321, repeat('a', 64),
  case when item = 3 then 'pending' else 'ready' end,
  case when item = 3 then null else statement_timestamp() end
from generate_series(1, 3) as item;

insert into public.total_loss_communications (
  id, case_id, negotiation_round_id, direction, channel,
  communication_type, status, original_content, occurred_at,
  recorded_by_user_id, supersedes_communication_id
)
select
  ('a2000000-0000-4000-8000-' || lpad(item::text, 12, '0'))::uuid,
  'e2000000-0000-4000-8000-000000000001',
  'ef000000-0000-4000-8000-000000000001',
  'inbound', 'uploaded_document', 'insurer_response', 'draft',
  'Saved original response text.', statement_timestamp(),
  'e1000000-0000-4000-8000-000000000001',
  case when item = 1 then null else
    ('a2000000-0000-4000-8000-' || lpad((item - 1)::text, 12, '0'))::uuid
  end
from generate_series(1, 6) as item;

insert into public.total_loss_communication_documents (
  case_id, communication_id, document_id
) values
  ('e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002'),
  ('e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000003'),
  ('e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001');

update public.total_loss_communications
set status = 'confirmed', confirmed_at = statement_timestamp()
where id in (
  'a2000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000003',
  'a2000000-0000-4000-8000-000000000004',
  'a2000000-0000-4000-8000-000000000005'
);

select ok(
  has_function_privilege('service_role', 'public.authorize_total_loss_insurer_response_original_download(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.authorize_total_loss_insurer_response_original_download(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.authorize_total_loss_insurer_response_original_download(uuid,uuid,uuid)', 'EXECUTE'),
  'private original locators are available only through the service role'
);

set local role service_role;
select is((
  select document_id from public.authorize_total_loss_insurer_response_original_download(
    'e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001'
  )
), 'a1000000-0000-4000-8000-000000000001'::uuid, 'the entitled owner can access the sealed submitted original');

select is((
  select document_id from public.authorize_total_loss_insurer_response_original_download(
    'e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001'
  )
), 'a1000000-0000-4000-8000-000000000001'::uuid, 'a correction retaining an attachment resolves the same immutable original');

select is((
  select document_id from public.authorize_total_loss_insurer_response_original_download(
    'e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000001'
  )
), 'a1000000-0000-4000-8000-000000000002'::uuid, 'a replacement correction resolves its own original without overwriting predecessors');

select is((
  select count(*) from public.authorize_total_loss_insurer_response_original_download(
    'e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002'
  )
), 0::bigint, 'a different owner cannot authorize the response original');

select is((
  select count(*) from public.authorize_total_loss_insurer_response_original_download(
    'e2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001'
  )
), 0::bigint, 'a response identifier cannot cross the requested case boundary');

select is((
  select count(*) from public.authorize_total_loss_insurer_response_original_download(
    'e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000004', 'e1000000-0000-4000-8000-000000000001'
  )
), 0::bigint, 'text-only responses do not invent an original download');

select is((
  select count(*) from public.authorize_total_loss_insurer_response_original_download(
    'e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000005', 'e1000000-0000-4000-8000-000000000001'
  )
), 0::bigint, 'a pending document cannot be downloaded through a response link');

select is((
  select count(*) from public.authorize_total_loss_insurer_response_original_download(
    'e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000006', 'e1000000-0000-4000-8000-000000000001'
  )
), 0::bigint, 'an unsubmitted response cannot authorize even a ready document');

select is((
  select count(*) from public.authorize_total_loss_insurer_response_original_download(
    'e2000000-0000-4000-8000-000000000001', 'ef300000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001'
  )
), 0::bigint, 'outbound messages do not authorize insurer-response originals');

select is((
  select count(*) from public.authorize_total_loss_insurer_response_original_download(
    'e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', null
  )
), 0::bigint, 'a missing authenticated owner does not authorize an original');

reset role;
update public.case_entitlements set status = 'suspended'
where id = 'e8000000-0000-4000-8000-000000000001';
select is((
  select count(*) from public.authorize_total_loss_insurer_response_original_download(
    'e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001'
  )
), 0::bigint, 'suspended entitlement cannot authorize an original');

update public.case_entitlements
set status = 'revoked', revoked_at = statement_timestamp(), reason_code = 'PAYMENT_REVERSED'
where id = 'e8000000-0000-4000-8000-000000000001';
select is((
  select count(*) from public.authorize_total_loss_insurer_response_original_download(
    'e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001'
  )
), 0::bigint, 'revoked entitlement cannot authorize an original');

update public.case_entitlements
set status = 'active', revoked_at = null, reason_code = null
where id = 'e8000000-0000-4000-8000-000000000001';
update auth.users set is_anonymous = true
where id = 'e1000000-0000-4000-8000-000000000001';
select is((
  select count(*) from public.authorize_total_loss_insurer_response_original_download(
    'e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001'
  )
), 0::bigint, 'anonymous accounts cannot authorize response originals');
update auth.users set is_anonymous = false, email_confirmed_at = null
where id = 'e1000000-0000-4000-8000-000000000001';
select is((
  select count(*) from public.authorize_total_loss_insurer_response_original_download(
    'e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001'
  )
), 0::bigint, 'unconfirmed accounts cannot authorize response originals');
update auth.users set email_confirmed_at = statement_timestamp()
where id = 'e1000000-0000-4000-8000-000000000001';

select throws_ok(
  $$update public.total_loss_claim_documents set original_filename = 'changed.pdf'
    where id = 'a1000000-0000-4000-8000-000000000001'$$,
  '55000', null, 'authorizing an original leaves sealed document immutability unchanged'
);
select throws_ok(
  $$delete from public.total_loss_communication_documents
    where communication_id = 'a2000000-0000-4000-8000-000000000001'$$,
  '55000', null, 'authorizing an original leaves confirmed attachment linkage immutable'
);
select ok(
  not exists (
    select 1 from public.authorize_total_loss_insurer_response_original_download(
      'e2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001'
    ) where storage_bucket_id <> 'case-files'
      or storage_object_name <> storage_owner_id::text || '/' || case_id::text
        || '/insurer-responses/' || document_id::text || '.pdf'
  ),
  'authorized locators remain in the exact case document namespace'
);

select * from finish();
rollback;
