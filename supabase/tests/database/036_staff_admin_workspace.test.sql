begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Valid paid claim fixture for the staff read projections; all records roll back.
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

insert into auth.users(id,email,email_confirmed_at,is_anonymous,raw_user_meta_data) values
 ('35000000-0000-4000-8000-000000000001','staff-directory@example.test',statement_timestamp(),false,'{"secret":"STAFF_HIDDEN_METADATA"}'),
 ('35000000-0000-4000-8000-000000000002','empty-directory@example.test',null,false,'{}'),
 ('35000000-0000-4000-8000-000000000003',null,null,true,'{}'),
 ('35000000-0000-4000-8000-000000000004',null,null,true,'{}');
insert into public.staff_members(user_id) values
 ('35000000-0000-4000-8000-000000000001'),('35000000-0000-4000-8000-000000000003');
insert into public.appraisal_cases(id,user_id,service_type,status,created_at,updated_at,last_activity_at) values
 ('35100000-0000-4000-8000-000000000001','35000000-0000-4000-8000-000000000003','total_loss','draft','2026-09-01','2026-09-01','2026-09-01'),
 ('35100000-0000-4000-8000-000000000002','35000000-0000-4000-8000-000000000003','total_loss','draft','2026-09-01','2026-09-01','2026-09-01'),
 ('35100000-0000-4000-8000-000000000003','35000000-0000-4000-8000-000000000003','diminished_value','draft','2026-09-01','2026-09-01','2026-09-01');
insert into public.total_loss_workflow_events(id,case_id,event_type,actor_type,actor_user_id,details) values
 ('35200000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','request.customer_reported_sent','customer','b1000000-0000-4000-8000-000000000001',
 '{"messageBody":"STAFF_HIDDEN_MESSAGE","providerPayload":"STAFF_HIDDEN_PROVIDER"}');

insert into public.total_loss_claim_documents(id,case_id,document_kind,status,original_filename) values
 ('35250000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','valuation_evidence_report','pending','pending-generated.pdf'),
 ('35250000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','insurer_response','pending','response-upload.pdf'),
 ('35250000-0000-4000-8000-000000000003','35100000-0000-4000-8000-000000000003','insurer_response','pending','disabled-service.pdf');

-- Preserve an old failed intake attempt behind the active paid workflow.
insert into public.total_loss_analysis_jobs(id,case_id,source_details_updated_at,status,attempt_count,
 processing_token,source_intake_mode,source_analysis_input_revision,source_analysis_input_id,
 failure_code,retryable,finished_at) values
 ('35300000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',statement_timestamp(),
 'failed',1,gen_random_uuid(),'manual',2,gen_random_uuid(),'OLD_ATTEMPT_FAILED',false,statement_timestamp());

select ok(not has_table_privilege('authenticated','public.staff_admin_case_index_internal','SELECT'),
 'private staff index has no direct authenticated read grant');
select ok(not has_function_privilege('authenticated','public.staff_admin_rows_internal(text,boolean,text)','EXECUTE'),
 'broad projection helper cannot be called by browser roles');
select ok(not has_function_privilege('anon','public.staff_admin_list(text,text,jsonb,text,integer,integer)','EXECUTE'),
 'anonymous role cannot invoke the staff list');
select ok(not has_function_privilege('service_role','public.staff_admin_overview()','EXECUTE'),
 'service role receives no additional staff API grants');
select ok((select bool_and(p.prosecdef and p.provolatile='s' and 'search_path=""'=any(p.proconfig))
 from pg_proc p where p.oid in ('public.staff_admin_list(text,text,jsonb,text,integer,integer)'::regprocedure,
 'public.staff_admin_overview()'::regprocedure,'public.staff_admin_customer(uuid)'::regprocedure,
 'public.staff_admin_case(uuid)'::regprocedure,'public.staff_admin_record(text,text)'::regprocedure)),'public staff RPCs are stable pinned security definers');

set local role authenticated;
set local request.jwt.claim.sub='35000000-0000-4000-8000-000000000002';
select throws_ok($$select public.staff_admin_list('cases')$$,'42501','Staff access required.','nonstaff list rejected');
select throws_ok($$select public.staff_admin_overview()$$,'42501','Staff access required.','nonstaff overview rejected');
select throws_ok($$select public.staff_admin_record('processing','b9000000-0000-4000-8000-000000000001')$$,
 '42501','Staff access required.','nonstaff operational record detail rejected');
select throws_ok($$select public.staff_admin_customer('35000000-0000-4000-8000-000000000001')$$,'42501','Staff access required.','nonstaff customer details rejected');
select throws_ok($$select public.staff_admin_case('b2000000-0000-4000-8000-000000000001')$$,'42501','Staff access required.','nonstaff case detail rejected');
set local request.jwt.claim.sub='35000000-0000-4000-8000-000000000003';
select throws_ok($$select public.staff_admin_overview()$$,'42501','Staff access required.','anonymous membership cannot grant staff access');
select throws_ok($$select public.staff_admin_record('payments','b7000000-0000-4000-8000-000000000001')$$,
 '42501','Staff access required.','anonymous membership cannot read demand-loaded record details');
set local request.jwt.claim.sub='35000000-0000-4000-8000-000000000001';
select throws_ok($$select public.staff_admin_list('unknown')$$,'22023','Invalid staff list arguments.','unknown resource rejected');
select throws_ok($$select public.staff_admin_list('cases',page_size=>101)$$,'22023','Invalid staff list arguments.','unbounded page rejected');
select throws_ok($$select public.staff_admin_list('cases',page=>0)$$,'22023','Invalid staff list arguments.','zero page rejected');
select throws_ok($$select public.staff_admin_list('cases',filters=>'{}'::jsonb || jsonb_build_object('secret','x'))$$,'22023','Invalid staff list filter.','unknown filters rejected');
select throws_ok($$select public.staff_admin_list('cases',filters=>' {"attention":true}')$$,'22023','Invalid staff list filter.','nonstring filters rejected');
select throws_ok($$select public.staff_admin_list('cases',filters=>' {"attention":"yes"}')$$,'22023','Invalid staff list filter value.','invalid boolean filter rejected');
select throws_ok($$select public.staff_admin_list('cases',filters=>' {"caseId":"broken"}')$$,'22023','Invalid staff identity filter.','invalid UUID filter rejected');
select throws_ok($$select public.staff_admin_list('cases',search=>repeat('x',201))$$,'22023','Invalid staff list arguments.','oversized search rejected');
select throws_ok($$select public.staff_admin_list('cases',sort=>'random')$$,'22023','Invalid staff list arguments.','sort allowlist enforced');
select throws_ok($$select public.staff_admin_record('cases','b2000000-0000-4000-8000-000000000001')$$,
 '22023','Invalid staff record arguments.','record detail accepts only its four supported resources');
select throws_ok($$select public.staff_admin_record('reports','')$$,
 '22023','Invalid staff record arguments.','record detail rejects blank identifiers');
select throws_ok($$select public.staff_admin_record('reports',repeat('x',513))$$,
 '22023','Invalid staff record arguments.','record detail rejects oversized identifiers');
select is(public.staff_admin_record('reports','absent-record'),null::jsonb,'unknown record is unavailable');
select is(public.staff_admin_record('processing','bd000000-0000-4000-8000-000000000001'),null::jsonb,
 'record ID is scoped to its selected resource');
select is(public.staff_admin_record('reports','35250000-0000-4000-8000-000000000003'),null::jsonb,
 'demand-loaded records exclude documents associated with diminished value');
select is(public.staff_admin_record('reports','bd000000-0000-4000-8000-000000000001')->>'caseId',
 'b2000000-0000-4000-8000-000000000001','record detail retains exact case lineage');
select ok(not has_function_privilege('anon','public.staff_admin_record(text,text)','EXECUTE')
 and not has_function_privilege('service_role','public.staff_admin_record(text,text)','EXECUTE'),
 'record endpoint adds no anonymous or service-role grant');
select ok((select bool_and(item->'sections'='[]'::jsonb) from unnest(array['cases','customers','reports','processing','payments','activity']) resource
 cross join lateral jsonb_array_elements(public.staff_admin_list(resource)->'items') item),
 'every list resource omits demand-loaded sections');
select ok(jsonb_array_length(public.staff_admin_record('reports','bd000000-0000-4000-8000-000000000001')->'sections')>0,
 'a requested report record returns full metadata sections');
select ok(jsonb_array_length(public.staff_admin_record('activity','35200000-0000-4000-8000-000000000001')->'sections')>0,
 'a requested activity record returns its safe details');
select ok(jsonb_array_length(public.staff_admin_case('b2000000-0000-4000-8000-000000000001')->'sections')>0
 and jsonb_array_length(public.staff_admin_customer('35000000-0000-4000-8000-000000000001')->'sections')>0,
 'case and customer detail retain full investigation sections');
select ok(public.staff_admin_record('activity','35200000-0000-4000-8000-000000000001')::text !~ 'STAFF_HIDDEN|messageBody|providerPayload',
 'demand-loaded activity still excludes raw event details');

select is((public.staff_admin_list('cases','', '{"customerId":"35000000-0000-4000-8000-000000000003"}', 'updated',1,1)->>'total')::integer,2,
 'matching count includes both total-loss cases and excludes diminished value');
select is(public.staff_admin_list('cases','', '{"customerId":"35000000-0000-4000-8000-000000000003"}', 'updated',1,1)#>>'{items,0,id}',
 '35100000-0000-4000-8000-000000000002','tied timestamps use descending ID order');
select is(public.staff_admin_list('cases','', '{"customerId":"35000000-0000-4000-8000-000000000003"}', 'updated',2,1)#>>'{items,0,id}',
 '35100000-0000-4000-8000-000000000001','pagination returns next tied row without duplication');
select is(jsonb_array_length(public.staff_admin_list('cases','', '{"customerId":"35000000-0000-4000-8000-000000000003"}', 'updated',3,1)->'items'),0,
 'out-of-range page is empty while retaining complete count');
select is((public.staff_admin_list('customers','empty-directory@example.test')->>'total')::integer,1,
 'registered accounts without cases remain visible');
select is(public.staff_admin_customer('35000000-0000-4000-8000-000000000002')->>'caseCount','0',
 'customer detail reports zero cases explicitly');
select is((public.staff_admin_list('customers','35000000-0000-4000-8000-000000000003')->>'total')::integer,0,
 'customers defaults to registered accounts');
select is((public.staff_admin_list('customers','35000000-0000-4000-8000-000000000003','{"identity":"guest"}')->>'total')::integer,1,
 'guest filter exposes case-linked anonymous identities');
select is(public.staff_admin_customer('35000000-0000-4000-8000-000000000004'),null::jsonb,
 'anonymous identities without total-loss cases remain outside directory');
select is(public.staff_admin_case('35100000-0000-4000-8000-000000000003'),null::jsonb,
 'diminished-value case detail is unavailable');
select is(public.staff_admin_case('b2000000-0000-4000-8000-000000000001')->>'status','awaiting_insurer_response',
 'paid current task is authoritative over old initial failures');
select is(public.staff_admin_case('b2000000-0000-4000-8000-000000000001')->'attentionReasons','[]'::jsonb,
 'old initial failure does not flag a successful paid workflow');
select is((public.staff_admin_list('cases','Honda','{"caseId":"b2000000-0000-4000-8000-000000000001"}')->>'total')::integer,1,
 'vehicle search matches canonical vehicle details');
select is((public.staff_admin_list('cases','does-not-exist','{"caseId":"b2000000-0000-4000-8000-000000000001"}')->>'total')::integer,0,
 'search no-results is distinct from missing dataset');
select is((public.staff_admin_list('processing','','{"caseId":"b2000000-0000-4000-8000-000000000001","kind":"paid_package"}')->>'total')::integer,1,
 'package work items do not inflate parent job counts');
select ok((public.staff_admin_record('processing','b9000000-0000-4000-8000-000000000001')::text) like '%Work item%',
 'package child work metadata appears in detail sections');
select is((public.staff_admin_list('processing','','{"caseId":"b2000000-0000-4000-8000-000000000001","active":"true"}')->>'total')::integer,0,
 'finished and historical jobs do not count as currently processing');
select is(public.staff_admin_list('reports','','{"caseId":"b2000000-0000-4000-8000-000000000001","kind":"generated"}')#>>'{items,0,status}',
 'published','generated reports preserve recorded publication state');
select ok(public.staff_admin_list('reports','','{"caseId":"b2000000-0000-4000-8000-000000000001"}')::text like '%Current published version%',
 'report current-version and current-publication facts are distinct');
select is((public.staff_admin_list('reports','','{"caseId":"b2000000-0000-4000-8000-000000000001","kind":"uploaded"}')->>'total')::integer,1,
 'unlinked generated report documents are not mislabeled as customer uploads');
select is(public.staff_admin_list('reports','','{"caseId":"b2000000-0000-4000-8000-000000000001","kind":"uploaded"}')#>>'{items,0,title}',
 'response-upload.pdf','uploaded document projection preserves its actual source');
select is(public.staff_admin_list('payments','','{"caseId":"b2000000-0000-4000-8000-000000000001"}')#>>'{items,0,status}',
 'paid','billing returns recorded order state');
select ok(public.staff_admin_list('payments','','{"caseId":"b2000000-0000-4000-8000-000000000001"}')::text like '%Test%',
 'billing identifies test mode');
select ok(public.staff_admin_list('payments','','{"caseId":"b2000000-0000-4000-8000-000000000001"}')::text like '%USD 9900 minor units%',
 'billing preserves exact recorded currency and minor-unit amount');
select is((public.staff_admin_list('payments','','{"caseId":"35100000-0000-4000-8000-000000000001"}')->>'total')::integer,0,
 'no purchase is an empty order set, not a fabricated payment status');
select is(public.staff_admin_list('activity','','{"caseId":"b2000000-0000-4000-8000-000000000001"}')#>>'{items,0,title}',
 'request.customer_reported_sent','workflow activity preserves customer-reported provenance');
select ok(public.staff_admin_list('activity','','{"caseId":"b2000000-0000-4000-8000-000000000001"}')::text !~ 'STAFF_HIDDEN|messageBody|providerPayload',
 'raw event details and message contents are excluded');
select ok(public.staff_admin_customer('35000000-0000-4000-8000-000000000001')::text !~ 'STAFF_HIDDEN|raw_user_meta_data|token',
 'account projection excludes authentication metadata and secrets');
select ok(public.staff_admin_list('processing','','{"caseId":"b2000000-0000-4000-8000-000000000001"}')::text !~ 'processing_token|dispatch_token|STAFF_HIDDEN',
 'processing projection excludes lease and dispatch tokens');
select is(public.staff_admin_overview()->>'attentionCases', public.staff_admin_list('cases','','{"attention":"true"}')->>'total',
 'overview attention count matches complete filtered dataset');
select is(public.staff_admin_overview()->>'processingJobs', public.staff_admin_list('processing','','{"active":"true"}')->>'total',
 'overview processing count matches complete filtered dataset');
select is(public.staff_admin_overview()->>'registeredAccounts', public.staff_admin_list('customers')->>'total',
 'overview registered count matches default account directory');
select ok(jsonb_array_length(public.staff_admin_overview()->'attention')<=5 and jsonb_array_length(public.staff_admin_overview()->'activity')<=8,
 'overview preview lists stay bounded');
select ok(public.staff_admin_list('cases')->>'asOf' is not null and public.staff_admin_overview()->>'asOf' is not null,
 'reads expose retrieval timestamps');
reset role;
insert into public.total_loss_communications(id,case_id,negotiation_round_id,direction,channel,
 communication_type,status,original_content,occurred_at,confirmed_at,recorded_by_user_id) values
 ('35400000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
 'be000000-0000-4000-8000-000000000001','inbound','email','insurer_response','confirmed',
 'STAFF_HIDDEN_RESPONSE_CONTENT',statement_timestamp(),statement_timestamp(),'b1000000-0000-4000-8000-000000000001');
insert into public.total_loss_insurer_response_analysis_jobs(id,case_id,negotiation_round_id,
 response_communication_id,source_report_version_id,source_message_version_id) values
 ('35500000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
 'be000000-0000-4000-8000-000000000001','35400000-0000-4000-8000-000000000001',
 'bd000000-0000-4000-8000-000000000001','be200000-0000-4000-8000-000000000001');
update public.total_loss_claim_workflows set current_response_analysis_job_id='35500000-0000-4000-8000-000000000001',
 current_task='insurer_response_received',revision=revision+1 where case_id='b2000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((public.staff_admin_list('processing','','{"caseId":"b2000000-0000-4000-8000-000000000001","kind":"insurer_response"}')->>'total')::integer,1,
 'third processing family exposes insurer-response metadata');
select is((public.staff_admin_list('processing','','{"caseId":"b2000000-0000-4000-8000-000000000001","active":"true"}')->>'total')::integer,1,
 'current pending response counts as one operational processing job');
select ok(public.staff_admin_list('processing','','{"caseId":"b2000000-0000-4000-8000-000000000001"}')::text not like '%STAFF_HIDDEN_RESPONSE_CONTENT%',
 'response job metadata never includes original response content');
reset role;
insert into public.total_loss_report_versions(id,case_id,report_series_id,version_number,final_assessment_id,
 preliminary_snapshot_id,renderer_version,template_version,schema_version,report,report_digest,status,
 supersedes_report_version_id,package_job_id) values
 ('35600000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
 'bb000000-0000-4000-8000-000000000001',2,'ba000000-0000-4000-8000-000000000001',
 'b6000000-0000-4000-8000-000000000001','1','1','1','{}',repeat('a',64),'draft',
 'bd000000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000001');
update public.total_loss_report_series set current_report_version_id='35600000-0000-4000-8000-000000000001'
 where id='bb000000-0000-4000-8000-000000000001';
insert into public.total_loss_release_reviews(id,case_id,status,report_version_id,final_assessment_id) values
 ('35700000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','queued',
 '35600000-0000-4000-8000-000000000001','ba000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.staff_admin_list('reports','','{"caseId":"b2000000-0000-4000-8000-000000000001","status":"draft"}')#>>'{items,0,status}',
 'draft','an unpublished replacement remains draft');
select is((select fact->>'value' from jsonb_array_elements(public.staff_admin_list('reports','','{"caseId":"b2000000-0000-4000-8000-000000000001","status":"draft"}')#>'{items,0,facts}') fact
 where fact->>'label'='Published at'),null::text,'draft report has no fabricated publication timestamp');
select is((select fact->>'value' from jsonb_array_elements(public.staff_admin_list('reports','','{"caseId":"b2000000-0000-4000-8000-000000000001","status":"published"}')#>'{items,0,facts}') fact
 where fact->>'label'='Superseded'),'true','older published version preserves its supersession fact');
select ok(public.staff_admin_case('b2000000-0000-4000-8000-000000000001')->'attentionReasons' ? 'REPORT_REVIEW_HOLD',
 'review for current package replacement flags current case attention');
select is((public.staff_admin_list('reports','','{"caseId":"b2000000-0000-4000-8000-000000000001","attention":"true"}')->>'total')::integer,1,
 'report attention filtering remains accurate without loading review detail sections');
reset role;
insert into public.payment_transactions(id,case_id,order_id,payment_provider,transaction_kind,external_object_id,
 amount_minor_units,currency,provider_occurred_at) values
 ('35800000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001',
 'stripe','payment','pi_staff_directory_fixture',9900,'USD',statement_timestamp()),
 ('35800000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001',
 'stripe','refund','txn_staff_directory_refund_fixture',9900,'USD',statement_timestamp()),
 ('35800000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001',
 'stripe','adjustment','txn_staff_directory_refund_reversal_fixture',9900,'USD',statement_timestamp());
insert into public.commerce_refund_requests(id,case_id,order_id,payment_transaction_id,client_request_id,
 payment_provider,provider_livemode,external_refund_id,external_balance_transaction_id,
 external_failure_balance_transaction_id,refund_transaction_id,refund_reversal_transaction_id,
 access_policy,reason_code,amount_minor_units,currency,status,provider_status,failure_code,
 provider_occurred_at,finished_at,created_at) values
 ('35900000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001',
 '35800000-0000-4000-8000-000000000001',gen_random_uuid(),'stripe',false,'re_staff_directory_failed',
 'txn_staff_directory_failed','txn_staff_directory_reversed','35800000-0000-4000-8000-000000000002',
 '35800000-0000-4000-8000-000000000003','retain','CUSTOMER_REQUEST',9900,'USD','failed','failed','PROVIDER_FAILURE',
 statement_timestamp(),statement_timestamp(),'2026-09-01');
insert into public.commerce_disputes(id,case_id,order_id,payment_transaction_id,payment_provider,
 provider_livemode,external_dispute_id,latest_external_event_id,status,amount_minor_units,currency,
 prior_order_status,prior_entitlement_status,provider_occurred_at,opened_at) values
 ('35a00000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001',
 '35800000-0000-4000-8000-000000000001','stripe',false,'dp_staff_directory_fixture','evt_staff_directory_fixture','active',
 9900,'USD','paid','active',statement_timestamp(),statement_timestamp());
set local role authenticated;
select ok(public.staff_admin_case('b2000000-0000-4000-8000-000000000001')->'attentionReasons' ? 'REFUND_FAILED',
 'failed refund flags current operational attention');
select ok(public.staff_admin_case('b2000000-0000-4000-8000-000000000001')->'attentionReasons' ? 'ACTIVE_PAYMENT_DISPUTE',
 'active payment dispute is distinguished from historical dispute outcomes');
select ok(public.staff_admin_record('payments','b7000000-0000-4000-8000-000000000001')::text like '%35800000-0000-4000-8000-000000000003%',
 'refund reversal transaction is explicitly included in billing detail');
select ok(public.staff_admin_record('payments','b7000000-0000-4000-8000-000000000001')::text like '%Payment dispute%',
 'billing includes itemized dispute metadata');
reset role;
insert into public.payment_transactions(id,case_id,order_id,payment_provider,transaction_kind,external_object_id,
 amount_minor_units,currency,provider_occurred_at) values
 ('35800000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001',
 'stripe','refund','txn_staff_directory_success_fixture',9900,'USD',statement_timestamp());
insert into public.commerce_refund_requests(id,case_id,order_id,payment_transaction_id,client_request_id,
 payment_provider,provider_livemode,external_refund_id,external_balance_transaction_id,refund_transaction_id,
 access_policy,reason_code,amount_minor_units,currency,status,provider_status,provider_occurred_at,finished_at) values
 ('35900000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000001',
 '35800000-0000-4000-8000-000000000001',gen_random_uuid(),'stripe',false,'re_staff_directory_succeeded',
 'txn_staff_directory_success','35800000-0000-4000-8000-000000000004','retain','CUSTOMER_REQUEST',9900,'USD',
 'succeeded','succeeded',statement_timestamp(),statement_timestamp());
update public.commerce_orders set status='refunded',refunded_at=statement_timestamp() where id='b7000000-0000-4000-8000-000000000001';
update public.case_entitlements set status='refunded_access_retained' where id='b8000000-0000-4000-8000-000000000001';
set local role authenticated;
select ok(not (public.staff_admin_case('b2000000-0000-4000-8000-000000000001')->'attentionReasons' ? 'REFUND_FAILED'),
 'a successful successor refund clears historical refund failure attention');
select ok(not (public.staff_admin_list('payments','','{"caseId":"b2000000-0000-4000-8000-000000000001"}')#>'{items,0,attentionReasons}' ? 'REFUND_FAILED'),
 'billing and case attention agree after refund recovery');
select is((select fact->>'value' from jsonb_array_elements(public.staff_admin_list('payments','','{"caseId":"b2000000-0000-4000-8000-000000000001"}')#>'{items,0,facts}') fact
 where fact->>'label'='Access status'),'refunded_access_retained','refund does not imply revoked access');
select is(public.staff_admin_record('payments','b7000000-0000-4000-8000-000000000001')->>'updatedAt',
 public.staff_admin_list('payments','','{"caseId":"b2000000-0000-4000-8000-000000000001"}')#>>'{items,0,updatedAt}',
 'billing activity stays identical with detail aggregates omitted');
select is(public.staff_admin_list('payments','','{"caseId":"b2000000-0000-4000-8000-000000000001"}')#>'{items,0,sections}',
 '[]'::jsonb,'ledger history is absent until the order detail is requested');

reset role;
delete from public.staff_members where user_id='35000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.staff_admin_list('cases')$$,'42501','Staff access required.','membership revocation takes effect on next request');
select throws_ok($$select public.staff_admin_record('reports','bd000000-0000-4000-8000-000000000001')$$,
 '42501','Staff access required.','membership revocation also closes the record detail endpoint');
select * from finish();
rollback;
