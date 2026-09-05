begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(26);
set local venfour.test.response_intake_mode='report';

-- Shared paid claim fixture; every test owns its surrounding rollback transaction.
create temporary table response_vehicle_fixture on commit drop as
select coalesce(nullif(current_setting('venfour.test.response_intake_mode', true), ''), 'manual')::public.total_loss_intake_mode as mode,
  jsonb_build_object('year',2022,'make','Honda','model','Accord','trim','EX-L',
    'mileage',32000,'postalCode','60601','lossDate','2026-08-20') as vehicle;
alter table response_vehicle_fixture add column facts jsonb, add column artifact jsonb,
  add column presentation jsonb, add column preliminary jsonb, add column normalized jsonb,
  add column source jsonb, add column assessment jsonb;
update response_vehicle_fixture set facts = vehicle || jsonb_build_object(
  'vin',case when mode='manual' then '1HGCM82633A004352' end,
  'vehicleConfiguration',null,'insurerName',case when mode='manual' then 'Example Insurance' end,
  'insurerVehicleValuationMinorUnits',1800000);
update response_vehicle_fixture set artifact=jsonb_build_object(
  'runId','b5000000-0000-4000-8000-000000000001','requestDigest',repeat('1',64),
  'request',jsonb_build_object('baseDiscrepancyRequest',jsonb_build_object(
    'lossVehicle',vehicle-'lossDate','lossDate','2026-08-20')),
  'result',jsonb_build_object('discrepancyRequest',jsonb_build_object(
    'lossVehicle',vehicle-'lossDate','lossDate','2026-08-20'),
    'discrepancyResult',jsonb_build_object('classification','MATERIAL_UNDERVALUE_SIGNAL'))),
  presentation=jsonb_build_object('runId','b5000000-0000-4000-8000-000000000001',
    'vehicle',vehicle,'analysisScope',jsonb_build_object('inputMode',upper(mode::text))),
  normalized='{"schemaVersion":"1","report":{"provider":"CCC","providerId":"CCC","insurer":"Example Insurance","reportReferenceNumber":"SYNTHETIC-REPORT-001","claimReferenceNumber":"SYNTHETIC-CLAIM-001","lossDate":"2026-08-20","reportDate":"2026-05-21","effectiveDate":null},"vehicle":{"year":2022,"make":"Honda","model":"Accord","trim":"EX-L","vin":"1HGCM82633A004352","mileage":32000,"location":"60601","bodyStyle":"Sedan","engine":"Synthetic 2.0L","transmission":"Automatic","fuelType":"Gasoline","equipment":["Synthetic Safety Package","Synthetic Audio"]},"valuation":{"baseVehicleValue":20100,"conditionAdjustment":-100,"adjustedVehicleValue":18000,"insurerOffer":null,"taxes":[],"fees":[],"priorDamageAdjustment":null,"otherAdjustments":[],"total":20000},"condition":{"preLossCondition":null,"totalAdjustment":-100,"items":[{"category":"Exterior","component":"Synthetic panel","rating":"Synthetic rating","notes":"Fictional test condition only.","valueImpact":-100}]},"comparables":[{"number":1,"year":2024,"make":"Synthetic","model":"Sedan","trim":"SEL","vin":"SYNTHETICCCCVIN01","dealer":"Synthetic CCC Dealer 1","location":"Test City, MO 63026","distanceMiles":11,"mileage":49500,"listPrice":19800,"adjustments":{"package":100,"options":50,"mileage":25,"condition":25,"priorDamage":null,"other":null},"adjustedValue":20000,"contributionPercent":34},{"number":2,"year":2024,"make":"Synthetic","model":"Sedan","trim":"SEL","vin":"SYNTHETICCCCVIN02","dealer":"Synthetic CCC Dealer 2","location":"Test City, MO 63026","distanceMiles":12,"mileage":50000,"listPrice":20100,"adjustments":{"package":-50,"options":-25,"mileage":-25,"condition":0,"priorDamage":null,"other":null},"adjustedValue":20000,"contributionPercent":33},{"number":3,"year":2024,"make":"Synthetic","model":"Sedan","trim":"SEL","vin":"SYNTHETICCCCVIN03","dealer":"Synthetic CCC Dealer 3","location":"Test City, MO 63026","distanceMiles":13,"mileage":50500,"listPrice":20400,"adjustments":{"package":-100,"options":-100,"mileage":-100,"condition":-100,"priorDamage":null,"other":null},"adjustedValue":20000,"contributionPercent":33}],"valuationNotes":["Fictional CCC note used only for testing."],"supplementalInformation":{"historyChecks":["Synthetic history check"],"historyEvents":["Synthetic history event"],"recalls":["Synthetic recall entry"]}}'::jsonb;
update response_vehicle_fixture set preliminary=jsonb_build_object(
  'classification','MATERIAL_UNDERVALUE_SIGNAL','presentation',presentation);
update response_vehicle_fixture set source=jsonb_build_object(
  'schemaVersion','1',
  'lineage',jsonb_build_object('caseId','b2000000-0000-4000-8000-000000000001',
    'packageJobId','b9000000-0000-4000-8000-000000000001',
    'entitlementId','b8000000-0000-4000-8000-000000000001',
    'preliminarySnapshotId','b6000000-0000-4000-8000-000000000001',
    'sourceSnapshotId','bf000000-0000-4000-8000-000000000001',
    'analysisJobId','b4000000-0000-4000-8000-000000000001',
    'analysisRunId','b5000000-0000-4000-8000-000000000001'),
  'input',jsonb_build_object('intakeMode',upper(mode::text),'analysisInputRevision',1,
    'analysisInputId','b3000000-0000-4000-8000-000000000001',
    'reportUploadId',case when mode='report' then 'bf100000-0000-4000-8000-000000000001' end,
    'confirmedFacts',facts,'inputDigest',public.total_loss_canonical_jsonb_digest(facts)),
  'analysis',jsonb_build_object('artifact',artifact,
    'artifactDigest',public.total_loss_canonical_jsonb_digest(artifact),'requestDigest',repeat('1',64)),
  'preliminary',jsonb_build_object('presentation',presentation,'snapshot',preliminary,
    'snapshotDigest',public.total_loss_canonical_jsonb_digest(preliminary),
    'presentationDigest',public.total_loss_canonical_jsonb_digest(presentation)),
  'sourceDocument',case when mode='report' then jsonb_build_object(
    'uploadId','bf100000-0000-4000-8000-000000000001','sha256',repeat('a',64)) end,
  'extraction',case when mode='report' then jsonb_build_object(
    'normalizedReport',normalized,'normalizedReportDigest',public.total_loss_canonical_jsonb_digest(normalized),
    'documentSha256',repeat('a',64)) end);
update response_vehicle_fixture set source=source || jsonb_build_object(
  'snapshotDigest',public.total_loss_canonical_jsonb_digest(source));
update response_vehicle_fixture set assessment=jsonb_build_object('schemaVersion','1',
  'lineage',(source->'lineage')-'analysisJobId','sourceSnapshotDigest',source->>'snapshotDigest',
  'analysisArtifactDigest',source#>>'{analysis,artifactDigest}',
  'subjectVehicle',vehicle || jsonb_build_object('vin',facts->'vin',
    'vehicleConfiguration',facts->'vehicleConfiguration','evidenceIds','[]'::jsonb));
update response_vehicle_fixture set assessment=assessment || jsonb_build_object(
  'assessmentDigest',public.total_loss_canonical_jsonb_digest(assessment));

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
  analysis_input_id, report_last_upload_id, report_original_filename, report_uploaded_at
) values (
  'b2000000-0000-4000-8000-000000000001', (select mode from response_vehicle_fixture),
  (select facts->>'vin' from response_vehicle_fixture),
  (select case when mode='manual' then 2022 end from response_vehicle_fixture),
  (select case when mode='manual' then 'Honda' end from response_vehicle_fixture),
  (select case when mode='manual' then 'Accord' end from response_vehicle_fixture),
  (select case when mode='manual' then 'EX-L' end from response_vehicle_fixture),
  (select case when mode='manual' then 32000 end from response_vehicle_fixture),
  '60601', '2026-08-20', 'Example Insurance', 18000,
  statement_timestamp(), 1, 'b3000000-0000-4000-8000-000000000001',
  (select case when mode='report' then 'bf100000-0000-4000-8000-000000000001'::uuid end from response_vehicle_fixture),
  (select case when mode='report' then 'valuation.pdf' end from response_vehicle_fixture),
  (select case when mode='report' then statement_timestamp() end from response_vehicle_fixture)
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
  source_analysis_input_revision, source_analysis_input_id, source_report_upload_id
) values (
  'b4000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001', statement_timestamp(),
  'completed', 1, gen_random_uuid(),
  'b5000000-0000-4000-8000-000000000001', statement_timestamp(),
  (select mode from response_vehicle_fixture), 1, 'b3000000-0000-4000-8000-000000000001',
  (select case when mode='report' then 'bf100000-0000-4000-8000-000000000001'::uuid end from response_vehicle_fixture)
);

insert into public.analysis_runs (
  id, job_id, case_id, artifact, request_digest,
  analysis_run_schema_version, analysis_version,
  discrepancy_analysis_version, comparable_scoring_version
) values (
  'b5000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  (select artifact from response_vehicle_fixture),
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
  snapshot, snapshot_digest, source_report_upload_id
) values (
  'b6000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000001',
  'b5000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001', (select mode from response_vehicle_fixture), 1,
  'b3000000-0000-4000-8000-000000000001',
  'MATERIAL_UNDERVALUE_SIGNAL', 1800000, 2000000, 2100000, 2200000,
  'USD', '4', '4', '1', '1', '1', '1',
  jsonb_build_object('analysisRunId', 'b5000000-0000-4000-8000-000000000001'),
  (select preliminary from response_vehicle_fixture),
  (select public.total_loss_canonical_jsonb_digest(preliminary) from response_vehicle_fixture),
  (select case when mode='report' then 'bf100000-0000-4000-8000-000000000001'::uuid end from response_vehicle_fixture)
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

insert into public.total_loss_source_snapshots (
  id,case_id,package_job_id,entitlement_id,preliminary_snapshot_id,analysis_job_id,analysis_run_id,
  owner_user_id_at_creation,source_intake_mode,source_report_upload_id,source_analysis_input_revision,source_analysis_input_id,
  source_document_bucket_id,source_document_object_name,source_document_media_type,source_document_byte_size,source_document_sha256,
  extraction_available,extraction_provider_name,extraction_schema_version,normalized_extraction_digest,
  analysis_artifact_digest,preliminary_snapshot_digest,request_digest,evidence_cutoff,snapshot_created_at,
  analysis_run_schema_version,analysis_version,discrepancy_analysis_version,comparable_scoring_version,
  presentation_schema_version,preliminary_snapshot_schema_version,snapshot_schema_version,source_snapshot,snapshot_digest
) select 'bf000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
  'b9000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000001',
  'b6000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',
  'b5000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',mode,
  case when mode='report' then 'bf100000-0000-4000-8000-000000000001'::uuid end,1,'b3000000-0000-4000-8000-000000000001',
  case when mode='report' then 'case-files' end,
  case when mode='report' then 'b1000000-0000-4000-8000-000000000001/b2000000-0000-4000-8000-000000000001/valuation-report.pdf' end,
  case when mode='report' then 'application/pdf' end,case when mode='report' then 1234 end,
  case when mode='report' then repeat('a',64) end,mode='report',
  case when mode='report' then 'fixture-extractor' end,case when mode='report' then '1' end,
  case when mode='report' then public.total_loss_canonical_jsonb_digest(normalized) end,
  public.total_loss_canonical_jsonb_digest(artifact),public.total_loss_canonical_jsonb_digest(preliminary),
  repeat('1',64),'2026-08-20',statement_timestamp(),'4','4','1','1','1','1','1',source,source->>'snapshotDigest'
from response_vehicle_fixture;

insert into public.workflow_work_items (
  id,case_id,package_job_id,work_type,work_version,status
) values ('bf200000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
  'b9000000-0000-4000-8000-000000000001','total_loss_report_generate','1','queued');

insert into public.total_loss_final_assessments (
  id, case_id, package_job_id, preliminary_snapshot_id,
  version_number, conclusion_code, currency,
  supported_range_low_minor_units, supported_range_median_minor_units,
  supported_range_high_minor_units, findings, limitations, reason_codes,
  preliminary_to_final_comparison, assessment, methodology_version,
  schema_version, assessment_digest, source_snapshot_id
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
  (select assessment from response_vehicle_fixture),
  '1', '1', (select assessment->>'assessmentDigest' from response_vehicle_fixture),
  'bf000000-0000-4000-8000-000000000001'
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
  schema_version, report, report_digest, status, published_at, package_job_id,
  source_snapshot_id,source_snapshot_digest,assessment_digest,generation_work_item_id,
  validation_version,validation_manifest,pdf_digest,pdf_byte_size,generated_at
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
  'b9000000-0000-4000-8000-000000000001',
  'bf000000-0000-4000-8000-000000000001',
  (select source->>'snapshotDigest' from response_vehicle_fixture),
  (select assessment->>'assessmentDigest' from response_vehicle_fixture),
  'bf200000-0000-4000-8000-000000000001','1','{}'::jsonb,repeat('8',64),321,statement_timestamp()
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


create function pg_temp.fixture_workflow_revision() returns bigint
language sql stable security definer set search_path='' as $$
  select revision from public.total_loss_claim_workflows
  where case_id='b2000000-0000-4000-8000-000000000001';
$$;

-- These context tests deliberately model corrupted persisted evidence inside a
-- rolled-back subtransaction; immutable production history remains protected.
create function pg_temp.probe_frozen_vehicle(change_sql text, should_reject boolean)
returns boolean language plpgsql as $$
declare mutation_completed boolean:=false; actual jsonb; matched boolean;
begin
  begin
    alter table public.total_loss_source_snapshots disable trigger user;
    alter table public.total_loss_final_assessments disable trigger user;
    alter table public.total_loss_report_versions disable trigger user;
    alter table public.total_loss_case_details disable trigger user;
    execute change_sql;
    mutation_completed:=true;
    actual:=public.total_loss_frozen_response_vehicle(
      'bd000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
      'b6000000-0000-4000-8000-000000000001');
    matched:=actual='{"vin":"1HGCM82633A004352","year":2022,"make":"Honda","model":"Accord","trim":"EX-L","mileageAtLoss":32000}'::jsonb;
    raise exception using errcode='P0001',message='Rollback isolated source probe';
  exception when sqlstate '55000' then return mutation_completed and should_reject;
    when sqlstate 'P0001' then return mutation_completed and not should_reject and matched;
  end;
end;
$$;

create function pg_temp.reseal_vehicle_fixture() returns void language plpgsql as $$
begin
  update public.total_loss_source_snapshots set snapshot_digest=public.total_loss_canonical_jsonb_digest(source_snapshot-'snapshotDigest')
  where id='bf000000-0000-4000-8000-000000000001';
  update public.total_loss_source_snapshots set source_snapshot=jsonb_set(source_snapshot,'{snapshotDigest}',to_jsonb(snapshot_digest))
  where id='bf000000-0000-4000-8000-000000000001';
  update public.total_loss_final_assessments set assessment=jsonb_set(assessment,'{sourceSnapshotDigest}',
    (select to_jsonb(snapshot_digest) from public.total_loss_source_snapshots where id='bf000000-0000-4000-8000-000000000001'))
  where id='ba000000-0000-4000-8000-000000000001';
  update public.total_loss_final_assessments set assessment_digest=public.total_loss_canonical_jsonb_digest(assessment-'assessmentDigest')
  where id='ba000000-0000-4000-8000-000000000001';
  update public.total_loss_final_assessments set assessment=jsonb_set(assessment,'{assessmentDigest}',to_jsonb(assessment_digest))
  where id='ba000000-0000-4000-8000-000000000001';
  update public.total_loss_report_versions set
    source_snapshot_digest=(select snapshot_digest from public.total_loss_source_snapshots where id='bf000000-0000-4000-8000-000000000001'),
    assessment_digest=(select assessment_digest from public.total_loss_final_assessments where id='ba000000-0000-4000-8000-000000000001')
  where id='bd000000-0000-4000-8000-000000000001';
end;
$$;

select ok(not coalesce(has_function_privilege('authenticated',to_regprocedure('public.total_loss_frozen_response_vehicle(uuid,uuid,uuid)'),'EXECUTE'),true)
  and not coalesce(has_function_privilege('service_role',to_regprocedure('public.total_loss_frozen_response_vehicle(uuid,uuid,uuid)'),'EXECUTE'),true),
  'frozen vehicle projection is internal to the trusted context assembler');
select ok((select vehicle_year is null and vehicle_make is null and vehicle_model is null
  and vehicle_trim is null and mileage_at_loss is null and vin is null
  from public.total_loss_case_details where case_id='b2000000-0000-4000-8000-000000000001'),
  'report intake legitimately leaves every manual vehicle column null');
select ok((select source_intake_mode='report' and extraction_available
  and source_snapshot#>'{input,confirmedFacts,vin}'='null'::jsonb
  and source_snapshot#>>'{extraction,normalizedReport,vehicle,vin}'='1HGCM82633A004352'
  from public.total_loss_source_snapshots where id='bf000000-0000-4000-8000-000000000001'),
  'report VIN remains extracted evidence rather than customer-confirmed input');

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
create temporary table first_response on commit drop as
select public.record_total_loss_insurer_response('b2000000-0000-4000-8000-000000000001',
  gen_random_uuid(),'The vehicle offer remains unchanged.',null,null,null,null,3) as response;
reset role;
set local role service_role;
create temporary table first_claim on commit drop as
select * from public.claim_current_total_loss_insurer_response_analysis(
  'b2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000031',
  'analysis-provider','response-model-v1','1','1','2');
create temporary table first_context on commit drop as
select * from public.resolve_total_loss_insurer_response_analysis_context(
  (select job_id from first_claim),'c2000000-0000-4000-8000-000000000031');
select is((select analysis_context->'vehicle' from first_context),
  '{"vin":"1HGCM82633A004352","year":2022,"make":"Honda","model":"Accord","trim":"EX-L","mileageAtLoss":32000}'::jsonb,
  'actual report response RPC context uses complete frozen report facts despite null manual columns');
select is((select analysis_context->>'contextVersion' from first_context),'2',
  'new processing attempts explicitly identify the frozen vehicle context version');
select ok((select (select count(*)=6 from jsonb_object_keys(analysis_context->'vehicle'))
  and not (analysis_context->'vehicle' ?| array['vehicleConfiguration','bodyStyle','engine','drivetrain'])
  from first_context),'vehicle output preserves the existing six-field downstream contract');
reset role;
select ok((select job.source_report_version_id=report.id and report.source_snapshot_id=source.id
  and source.preliminary_snapshot_id=workflow.preliminary_snapshot_id
  from public.total_loss_insurer_response_analysis_jobs job
  join public.total_loss_report_versions report on report.id=job.source_report_version_id
  join public.total_loss_source_snapshots source on source.id=report.source_snapshot_id
  join public.total_loss_claim_workflows workflow on workflow.case_id=job.case_id
  where job.id=(select job_id from first_claim)),
  'processing job pins the exact published report and frozen paid source');

select ok(pg_temp.probe_frozen_vehicle($change$
  update public.total_loss_case_details set vehicle_year=1999,vehicle_make='Other',
    vehicle_model='Draft',vehicle_trim='Changed',mileage_at_loss=999999,vin='DRAFTVIN'
  where case_id='b2000000-0000-4000-8000-000000000001'
$change$,false),'mutable draft vehicle values cannot override the frozen paid vehicle');
select ok(pg_temp.probe_frozen_vehicle($change$
  update public.total_loss_source_snapshots set snapshot_digest=repeat('0',64)
  where id='bf000000-0000-4000-8000-000000000001'
$change$,true),'invalid frozen source digest fails closed');
select ok(pg_temp.probe_frozen_vehicle($change$
  update public.total_loss_report_versions set source_snapshot_digest=repeat('0',64)
  where id='bd000000-0000-4000-8000-000000000001'
$change$,true),'published report cannot select an incompatible source digest');
select ok(pg_temp.probe_frozen_vehicle($change$
  update public.total_loss_report_versions set assessment_digest=repeat('0',64)
  where id='bd000000-0000-4000-8000-000000000001'
$change$,true),'published report cannot select an incompatible assessment digest');
select ok(pg_temp.probe_frozen_vehicle($change$
  update public.total_loss_source_snapshots set source_analysis_input_revision=2
  where id='bf000000-0000-4000-8000-000000000001'
$change$,true),'source outside the frozen preliminary revision fails closed');
select ok(pg_temp.probe_frozen_vehicle($change$
  update public.total_loss_source_snapshots set source_snapshot=jsonb_set(source_snapshot,'{lineage,analysisRunId}',
    '"b5000000-0000-4000-8000-000000000099"'::jsonb)
  where id='bf000000-0000-4000-8000-000000000001';
  select pg_temp.reseal_vehicle_fixture()
$change$,true),'a digest-consistent source with a conflicting embedded run identity fails closed');
select ok(pg_temp.probe_frozen_vehicle($change$
  update public.total_loss_source_snapshots set source_snapshot=jsonb_set(source_snapshot,
    '{preliminary,presentation,vehicle,year}','null'::jsonb)
  where id='bf000000-0000-4000-8000-000000000001';
  select pg_temp.reseal_vehicle_fixture()
$change$,true),'missing authoritative required vehicle evidence fails closed');
select ok(pg_temp.probe_frozen_vehicle($change$
  update public.total_loss_source_snapshots set source_snapshot=jsonb_set(source_snapshot,'{extraction}','null'::jsonb)
  where id='bf000000-0000-4000-8000-000000000001';
  select pg_temp.reseal_vehicle_fixture()
$change$,true),'report source without its frozen extraction fails closed');
select ok(pg_temp.probe_frozen_vehicle($change$
  update public.total_loss_source_snapshots set source_snapshot=jsonb_set(source_snapshot,
    '{extraction,normalizedReport,vehicle,make}','"Ford"'::jsonb)
  where id='bf000000-0000-4000-8000-000000000001';
  update public.total_loss_source_snapshots set normalized_extraction_digest=
    public.total_loss_canonical_jsonb_digest(source_snapshot#>'{extraction,normalizedReport}')
  where id='bf000000-0000-4000-8000-000000000001';
  update public.total_loss_source_snapshots set source_snapshot=jsonb_set(source_snapshot,
    '{extraction,normalizedReportDigest}',to_jsonb(normalized_extraction_digest))
  where id='bf000000-0000-4000-8000-000000000001';
  select pg_temp.reseal_vehicle_fixture()
$change$,true),'digest-consistent extracted vehicle conflict cannot silently win');
select ok(pg_temp.probe_frozen_vehicle($change$
  update public.total_loss_source_snapshots set source_snapshot=jsonb_set(source_snapshot,
    '{analysis,artifact,result,discrepancyRequest,lossVehicle,make}','"Ford"'::jsonb)
  where id='bf000000-0000-4000-8000-000000000001';
  select pg_temp.reseal_vehicle_fixture()
$change$,true),'frozen artifact content cannot change behind its saved artifact digest');
select ok(pg_temp.probe_frozen_vehicle($change$
  update public.total_loss_source_snapshots set source_snapshot=jsonb_set(source_snapshot,
    '{extraction,normalizedReport,vehicle,make}','" HONDA  "'::jsonb)
  where id='bf000000-0000-4000-8000-000000000001';
  update public.total_loss_source_snapshots set normalized_extraction_digest=
    public.total_loss_canonical_jsonb_digest(source_snapshot#>'{extraction,normalizedReport}')
  where id='bf000000-0000-4000-8000-000000000001';
  update public.total_loss_source_snapshots set source_snapshot=jsonb_set(source_snapshot,
    '{extraction,normalizedReportDigest}',to_jsonb(normalized_extraction_digest))
  where id='bf000000-0000-4000-8000-000000000001';
  select pg_temp.reseal_vehicle_fixture()
$change$,false),'equivalent extraction whitespace and casing preserve canonical vehicle identity');
select ok(pg_temp.probe_frozen_vehicle($change$
  update public.total_loss_source_snapshots set source_snapshot=jsonb_set(source_snapshot,
    '{input,confirmedFacts,vin}','"1HGCM82633A004353"'::jsonb)
  where id='bf000000-0000-4000-8000-000000000001';
  update public.total_loss_final_assessments set assessment=jsonb_set(assessment,
    '{subjectVehicle,vin}','"1HGCM82633A004353"'::jsonb)
  where id='ba000000-0000-4000-8000-000000000001';
  select pg_temp.reseal_vehicle_fixture()
$change$,true),'conflicting frozen customer and extracted VIN values fail closed');
select ok(pg_temp.probe_frozen_vehicle($change$
  update public.total_loss_final_assessments set assessment=jsonb_set(assessment,
    '{subjectVehicle}','123'::jsonb)
  where id='ba000000-0000-4000-8000-000000000001';
  select pg_temp.reseal_vehicle_fixture()
$change$,true),'malformed scalar subject vehicle fails with a bounded source error');
select throws_ok($$select public.total_loss_frozen_response_vehicle(
  'bd000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000099',
  'b6000000-0000-4000-8000-000000000001')$$,'55000',null,
  'another case cannot borrow the paid report vehicle source');
select is((select source_snapshot from public.total_loss_source_snapshots where id='bf000000-0000-4000-8000-000000000001'),
  (select source from response_vehicle_fixture),'all invalid-source probes roll back their fixture mutations');

set local role authenticated;
create temporary table corrected_response on commit drop as
select public.record_total_loss_insurer_response('b2000000-0000-4000-8000-000000000001',
  gen_random_uuid(),'The insurer confirmed its prior offer. Corrected response entry.',null,null,null,
  (select (response#>>'{response,responseId}')::uuid from first_response),
  pg_temp.fixture_workflow_revision()) as response;
reset role;
set local role service_role;
create temporary table correction_claim on commit drop as
select * from public.claim_current_total_loss_insurer_response_analysis(
  'b2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000032',
  'analysis-provider','response-model-v1','1','1','2');
create temporary table correction_context on commit drop as
select * from public.resolve_total_loss_insurer_response_analysis_context(
  (select job_id from correction_claim),'c2000000-0000-4000-8000-000000000032');
select is((select analysis_context->'vehicle' from correction_context),
  (select analysis_context->'vehicle' from first_context),
  'ordinary response correction keeps the exact original frozen vehicle context');
reset role;
select ok((select old.source_report_version_id=new.source_report_version_id and old.id<>new.id
  and old.status='superseded' from public.total_loss_insurer_response_analysis_jobs old
  cross join public.total_loss_insurer_response_analysis_jobs new
  where old.id=(select job_id from first_claim) and new.id=(select job_id from correction_claim)),
  'correction preserves immutable source report lineage while creating a new response job');

-- A separate sent-round fixture exercises the same real intake and worker
-- contracts without involving unrelated provider recommendation behavior.
update public.total_loss_negotiation_rounds set status='closed',closed_at=statement_timestamp(),revision=revision+1
where id='be000000-0000-4000-8000-000000000001';
insert into public.total_loss_negotiation_rounds(id,case_id,round_number,status)
values('be000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001',2,'waiting_for_insurer');
insert into public.total_loss_message_drafts(id,case_id,negotiation_round_id,report_version_id,purpose,recipient,subject,body)
values('be100000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001',
 'be000000-0000-4000-8000-000000000002','bd000000-0000-4000-8000-000000000001',
 'follow_up_reconsideration','adjuster@example.test','Follow-up request','Please reconsider the same frozen vehicle evidence.');
insert into public.total_loss_message_versions(id,case_id,message_draft_id,negotiation_round_id,report_version_id,
 version_number,message_state,purpose,recipient,subject,body,message_digest,sent_at)
values('be200000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001',
 'be100000-0000-4000-8000-000000000002','be000000-0000-4000-8000-000000000002',
 'bd000000-0000-4000-8000-000000000001',1,'customer_reported_sent','follow_up_reconsideration',
 'adjuster@example.test','Follow-up request','Please reconsider the same frozen vehicle evidence.',repeat('9',64),statement_timestamp());
insert into public.total_loss_communications(id,case_id,negotiation_round_id,direction,channel,communication_type,status,
 sender,recipient,subject,original_content,occurred_at,confirmed_at,recorded_by_user_id,message_version_id)
values('be300000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001',
 'be000000-0000-4000-8000-000000000002','outbound','email','follow_up_reconsideration_request','confirmed',
 'analysis-owner@example.test','adjuster@example.test','Follow-up request','Please reconsider the same frozen vehicle evidence.',
 statement_timestamp(),statement_timestamp(),'b1000000-0000-4000-8000-000000000001','be200000-0000-4000-8000-000000000002');
update public.total_loss_negotiation_rounds set originating_communication_id='be300000-0000-4000-8000-000000000002',revision=revision+1
where id='be000000-0000-4000-8000-000000000002';
update public.total_loss_claim_workflows set current_task='awaiting_insurer_response',
 current_negotiation_round_id='be000000-0000-4000-8000-000000000002',revision=revision+1
where case_id='b2000000-0000-4000-8000-000000000001';
set local role authenticated;
create temporary table later_response on commit drop as
select public.record_total_loss_insurer_response('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),
 'The second insurer response concerns the same vehicle.',null,null,null,null,
 pg_temp.fixture_workflow_revision(),
 'be300000-0000-4000-8000-000000000002') as response;
reset role;
set local role service_role;
create temporary table later_claim on commit drop as
select * from public.claim_current_total_loss_insurer_response_analysis(
 'b2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000033',
 'analysis-provider','response-model-v1','1','1','2');
create temporary table later_context on commit drop as
select * from public.resolve_total_loss_insurer_response_analysis_context(
 (select job_id from later_claim),'c2000000-0000-4000-8000-000000000033');
select ok((select analysis_context#>>'{journey,negotiationRoundNumber}'='2'
 and analysis_context->'vehicle'=(select analysis_context->'vehicle' from first_context)
 from later_context),'a distinct second response round reuses the same frozen claim vehicle');
reset role;
select is((select count(distinct source_report_version_id) from public.total_loss_insurer_response_analysis_jobs
 where case_id='b2000000-0000-4000-8000-000000000001'),1::bigint,
 'original response correction and later round keep one paid report source identity');
select * from finish();
rollback;
