begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Reuse the same complete paid lineage for report and manual exclusions.
create function pg_temp.response_context_recovery_fixture(mode text)
returns void language plpgsql as $fixture_function$
begin
  perform set_config('venfour.test.response_intake_mode',
    case when mode='report_with_legacy_values' then 'report' else mode end, true);
  perform set_config('venfour.test.legacy_vehicle_populated',
    (mode='report_with_legacy_values')::text, true);
  execute $fixture_sql$
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
  (select case when mode='manual' or current_setting('venfour.test.legacy_vehicle_populated',true)='true' then 2022 end from response_vehicle_fixture),
  (select case when mode='manual' or current_setting('venfour.test.legacy_vehicle_populated',true)='true' then 'Honda' end from response_vehicle_fixture),
  (select case when mode='manual' or current_setting('venfour.test.legacy_vehicle_populated',true)='true' then 'Accord' end from response_vehicle_fixture),
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


$fixture_sql$;
end;
$fixture_function$;

create function pg_temp.record_recovery_response()
returns void language plpgsql as $$
declare upload jsonb; workflow_revision bigint;
begin
  perform set_config('request.jwt.claim.sub', 'b1000000-0000-4000-8000-000000000001', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  select revision into workflow_revision from public.total_loss_claim_workflows
    where case_id='b2000000-0000-4000-8000-000000000001';
  upload:=public.prepare_total_loss_insurer_response_upload(
    'b2000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
    'response.pdf','application/pdf',654,repeat('c',64),workflow_revision);
  insert into storage.objects(bucket_id,name,metadata,user_metadata)
  values('case-files',upload ->> 'uploadPath',
    jsonb_build_object('mimetype','application/pdf','contentLength',654,'size',654),
    jsonb_build_object('clientRequestId','c4000000-0000-4000-8000-000000000001',
      'originalName','response.pdf','contentDigest',repeat('c',64)));
  perform public.record_total_loss_insurer_response(
    'b2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001',
    'The attached response explains the unchanged offer.',null,
    'c4000000-0000-4000-8000-000000000001',null,null,workflow_revision);
end;
$$;

create function pg_temp.fail_recovery_response(failure_code text, context_version text)
returns table(job_id uuid, run_id uuid) language plpgsql as $$
declare claimed record;
begin
  select * into claimed from public.claim_current_total_loss_insurer_response_analysis(
    'b2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',
    'analysis-provider','response-context-test','2','1',context_version);
  perform public.fail_total_loss_insurer_response_analysis(claimed.job_id,
    'c2000000-0000-4000-8000-000000000001',claimed.run_id,failure_code,'terminal',0);
  return query select claimed.job_id,claimed.run_id;
end;
$$;

savepoint before_fixture;
select pg_temp.response_context_recovery_fixture('report');
select pg_temp.record_recovery_response();
savepoint pending_response;

create temporary table legacy_claim as
  select * from pg_temp.fail_recovery_response('INSURER_RESPONSE_ANALYSIS_CONTEXT_INVALID','1');
create temporary table original_run as select to_jsonb(run) as value
  from public.total_loss_insurer_response_analysis_runs run where id=(select run_id from legacy_claim);
create temporary table original_job as select to_jsonb(job) as value
  from public.total_loss_insurer_response_analysis_jobs job where id=(select job_id from legacy_claim);
create temporary table original_workflow as select revision from public.total_loss_claim_workflows
  where case_id='b2000000-0000-4000-8000-000000000001';

select ok(public.total_loss_legacy_response_context_retry_eligible((select job_id from legacy_claim)),
  'valid frozen report with a legacy pre-inference context failure is eligible');
select throws_ok($q$update public.total_loss_insurer_response_analysis_jobs
  set status='retryable_failed',retryable=true,attempt_count=attempt_count+1
  where id=(select job_id from legacy_claim)$q$,'55000',
  'Terminal insurer-response analysis jobs are immutable.',
  'reclassification cannot change attempt count or other immutable job fields');
select ok(public.recover_total_loss_legacy_response_context((select job_id from legacy_claim)),
  'scoped repair makes the existing response job retryable');
select ok((select (to_jsonb(job)-array['status','retryable','updated_at'])=
  (original.value-array['status','retryable','updated_at']) and job.status='retryable_failed' and job.retryable
  from public.total_loss_insurer_response_analysis_jobs job cross join original_job original
  where job.id=(select job_id from legacy_claim)),
  'repair preserves original response, document, report, run, lease and failure identities');
select is((select to_jsonb(run) from public.total_loss_insurer_response_analysis_runs run
  where id=(select run_id from legacy_claim)),(select value from original_run),
  'repair leaves the complete terminal attempt byte-for-byte unchanged');
select ok((select workflow.revision=original.revision+1
  from public.total_loss_claim_workflows workflow cross join original_workflow original
  where case_id='b2000000-0000-4000-8000-000000000001')
  and (select count(*)=1 and bool_and(actor_type='system'
    and associated_entity_id=(select job_id from legacy_claim)
    and details ->> 'failedRunId'=(select run_id::text from legacy_claim)
    and details ->> 'previousContextVersion'='1' and details ->> 'retryContextVersion'='2')
  from public.total_loss_workflow_events where case_id='b2000000-0000-4000-8000-000000000001'
    and event_type='insurer_response.context_retry_available'),
  'repair increments revision and records one auditable recovery-available event');
select ok(not public.recover_total_loss_legacy_response_context((select job_id from legacy_claim)),
  'reapplying the repair is inert');
select is((select count(*) from public.total_loss_workflow_events
  where case_id='b2000000-0000-4000-8000-000000000001'
    and event_type='insurer_response.context_retry_available'),1::bigint,
  'reapplying the repair does not duplicate its event');
select ok(not exists(select 1 from public.list_due_total_loss_insurer_response_analysis_jobs(100)
  where job_id=(select job_id from legacy_claim)),
  'repair does not start provider work before an explicit owner retry');
select throws_ok($q$update public.total_loss_insurer_response_analysis_runs set context_version='2'
  where id=(select run_id from legacy_claim)$q$,'55000',
  'Insurer-response analysis run identity is immutable.','old context-version audit metadata stays immutable');
select ok(not exists(select 1 from unnest(array['anon','authenticated','service_role']) as role_name
  where has_function_privilege(role_name,'public.recover_total_loss_legacy_response_context(uuid)','execute')
    or has_function_privilege(role_name,'public.total_loss_legacy_response_context_retry_eligible(uuid)','execute')),
  'recovery and eligibility helpers are private to the migration owner');

set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select ok((select insurer_response ->> 'processingState'='retryable_failed'
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'existing customer projection truthfully exposes its ordinary Retry action');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select throws_ok($q$select public.retry_total_loss_insurer_response_analysis(
  'b2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001',6)$q$,
  '42501','Response-analysis retry is unavailable.','another owner cannot retry the repaired case');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select throws_ok($q$select public.retry_total_loss_insurer_response_analysis(
  'b2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001',1)$q$,
  '40001','Claim workflow changed before response-analysis retry.','a stale owner revision cannot retry');
create temporary table owner_retry as select public.retry_total_loss_insurer_response_analysis(
  'b2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001',
  (select workflow_revision from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001'))
) as response;
select is(public.retry_total_loss_insurer_response_analysis(
  'b2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001',1),
  (select response from owner_retry),'normal owner retry remains idempotent');
reset role;
select ok((select status='pending' and current_run_id is null and attempt_count=1
  and response_communication_id=(original.value ->> 'response_communication_id')::uuid
  and source_document_id='c4000000-0000-4000-8000-000000000001'
  from public.total_loss_insurer_response_analysis_jobs job cross join original_job original
  where job.id=(select job_id from legacy_claim)),
  'normal Retry requeues the same job with the original submitted response document');
create temporary table retried_claim as select * from public.claim_current_total_loss_insurer_response_analysis(
  'b2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002',
  'analysis-provider','response-context-test','2','1','2');
select ok((select retried.outcome='claimed' and retried.attempt_count=2
  and retried.job_id=legacy.job_id and retried.run_id<>legacy.run_id
  from retried_claim retried cross join legacy_claim legacy)
  and (select context_version='2' from public.total_loss_insurer_response_analysis_runs
    where id=(select run_id from retried_claim)),
  'worker claim creates a distinct second immutable attempt under context version 2');
select is((select to_jsonb(run) from public.total_loss_insurer_response_analysis_runs run
  where id=(select run_id from legacy_claim)),(select value from original_run),
  'retry and new claim do not rewrite the original terminal run');
select ok((select analysis_context #>> '{contextVersion}'='2'
  and analysis_context #>> '{vehicle,year}'='2022'
  and analysis_context #>> '{vehicle,make}'='Honda'
  and analysis_context #>> '{vehicle,model}'='Accord'
  and analysis_context #>> '{vehicle,trim}'='EX-L'
  and analysis_context #>> '{vehicle,mileageAtLoss}'='32000'
  and response_document_id='c4000000-0000-4000-8000-000000000001'
  from public.resolve_total_loss_insurer_response_analysis_context(
    (select job_id from retried_claim),'c2000000-0000-4000-8000-000000000002')),
  'retried context has correct frozen report vehicle and retained response document');
rollback to pending_response;

create temporary table excluded_claim as
  select * from pg_temp.fail_recovery_response('INSURER_RESPONSE_ANALYSIS_OUTPUT_INVALID','1');
select ok(not public.recover_total_loss_legacy_response_context((select job_id from excluded_claim)),
  'the separate provider-output validation failure remains terminal');
select throws_ok($q$update public.total_loss_insurer_response_analysis_jobs
  set status='retryable_failed',retryable=true where id=(select job_id from excluded_claim)$q$,
  '55000','Terminal insurer-response analysis jobs are immutable.',
  'job guard does not make provider-output failures retryable');
rollback to pending_response;

create temporary table excluded_claim as
  select * from pg_temp.fail_recovery_response('INSURER_RESPONSE_ANALYSIS_CONTEXT_INVALID','2');
select ok(not public.recover_total_loss_legacy_response_context((select job_id from excluded_claim)),
  'a new-context failure does not qualify as the legacy defect');
rollback to pending_response;

create temporary table excluded_claim as
  select * from pg_temp.fail_recovery_response('INSURER_RESPONSE_ANALYSIS_CONTEXT_INVALID','1');
select public.record_total_loss_insurer_response(
  'b2000000-0000-4000-8000-000000000001',gen_random_uuid(),'Corrected response material.',null,
  null,'c4000000-0000-4000-8000-000000000001',
  (select response_communication_id from public.total_loss_insurer_response_analysis_jobs
    where id=(select job_id from excluded_claim)),
  (select revision from public.total_loss_claim_workflows
    where case_id='b2000000-0000-4000-8000-000000000001'));
select ok(not public.recover_total_loss_legacy_response_context((select job_id from excluded_claim)),
  'superseded response jobs are excluded from legacy recovery');
select throws_ok($q$update public.total_loss_insurer_response_analysis_jobs set status='retryable_failed',retryable=true
  where id=(select job_id from excluded_claim)$q$,'55000',
  'Superseded insurer-response analysis jobs are immutable.','superseded job history stays immutable');
rollback to pending_response;

create temporary table excluded_claim as
  select * from pg_temp.fail_recovery_response('INSURER_RESPONSE_ANALYSIS_CONTEXT_INVALID','1');
select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'CUSTOMER_STOPPED_PURSUING',(select revision from public.total_loss_claim_workflows
    where case_id='b2000000-0000-4000-8000-000000000001'));
select ok(not public.recover_total_loss_legacy_response_context((select job_id from excluded_claim)),
  'closed cases are not reopened by legacy recovery');
rollback to pending_response;

create temporary table completed_claim as select * from public.claim_current_total_loss_insurer_response_analysis(
  'b2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003',
  'analysis-provider','response-context-test','2','1','1');
update public.total_loss_insurer_response_analysis_runs set status='completed',returned_model_identifier='response-context-test',
  input_digest=repeat('d',64),output_digest=repeat('e',64),completed_at=statement_timestamp()
  where id=(select run_id from completed_claim);
update public.total_loss_insurer_response_analysis_jobs set status='completed',processing_expires_at=null,
  completed_at=statement_timestamp() where id=(select job_id from completed_claim);
select ok(not public.recover_total_loss_legacy_response_context((select job_id from completed_claim)),
  'completed jobs are excluded from the recovery path');
select throws_ok($q$update public.total_loss_insurer_response_analysis_jobs
  set status='retryable_failed',retryable=true where id=(select job_id from completed_claim)$q$,
  '55000','Terminal insurer-response analysis jobs are immutable.','completed job history cannot be reclassified');
rollback to before_fixture;

select pg_temp.response_context_recovery_fixture('report_with_legacy_values');
select pg_temp.record_recovery_response();
create temporary table populated_legacy_claim as
  select * from pg_temp.fail_recovery_response('INSURER_RESPONSE_ANALYSIS_CONTEXT_INVALID','1');
select ok(not public.recover_total_loss_legacy_response_context((select job_id from populated_legacy_claim)),
  'a report whose legacy required vehicle fields were valid is not treated as the pre-inference defect');
select throws_ok($q$update public.total_loss_insurer_response_analysis_jobs
  set status='retryable_failed',retryable=true where id=(select job_id from populated_legacy_claim)$q$,
  '55000','Terminal insurer-response analysis jobs are immutable.',
  'context failure after valid legacy vehicle fields keeps the terminal guard');
rollback to before_fixture;

select pg_temp.response_context_recovery_fixture('manual');
select pg_temp.record_recovery_response();
create temporary table manual_claim as
  select * from pg_temp.fail_recovery_response('INSURER_RESPONSE_ANALYSIS_CONTEXT_INVALID','1');
select ok(not public.recover_total_loss_legacy_response_context((select job_id from manual_claim)),
  'valid frozen manual cases are outside the legacy report-only repair');
select throws_ok($q$update public.total_loss_insurer_response_analysis_jobs
  set status='retryable_failed',retryable=true where id=(select job_id from manual_claim)$q$,
  '55000','Terminal insurer-response analysis jobs are immutable.','manual terminal jobs keep their existing guard');

select * from finish();
rollback;
