begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

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

create function pg_temp.resolution_error(request_id uuid, code text, expected_revision bigint,
  decision_id uuid default null, offer_id uuid default null, amount bigint default null, currency text default null)
returns jsonb language plpgsql as $$
declare error_detail text;
begin
  perform public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',
    request_id,code,expected_revision,decision_id,offer_id,amount,currency);
  return null;
exception when others then
  get stacked diagnostics error_detail = pg_exception_detail;
  return jsonb_build_object('code',sqlstate,'message',sqlerrm,'detail',error_detail);
end;
$$;

-- Manual closure deliberately requires no recommendation, decision, or offer.
savepoint manual_resolution;
create temporary table resolution_request as select gen_random_uuid() as request_id,
  revision as expected_revision from public.total_loss_claim_workflows where case_id='b2000000-0000-4000-8000-000000000001';
select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',
  (select request_id from resolution_request),'RESOLVED_WITH_INSURER',(select expected_revision from resolution_request));
create temporary table original_closed_state as select
  (select to_jsonb(workflow) from public.total_loss_claim_workflows workflow
    where case_id='b2000000-0000-4000-8000-000000000001') as workflow,
  (select jsonb_agg(to_jsonb(event) order by id) from public.total_loss_workflow_events event
    where case_id='b2000000-0000-4000-8000-000000000001') as events;
select ok((select resolution_code='RESOLVED_WITH_INSURER' and resolved_at is not null and phase='resolution'
  and current_task='resolved' and resolution_details ->> 'amountMinorUnits' is null
  and resolution_details ->> 'amountSource' is null from public.total_loss_claim_workflows
  where case_id='b2000000-0000-4000-8000-000000000001'),'manual resolution closes without amount or Accept');
select ok((select case_status='closed' and case_stage='closed' and has_total_loss_claim_workflow
  from public.list_owned_case_operations() where case_id='b2000000-0000-4000-8000-000000000001'),
  'owned history projects workflow closure while retaining its claim route');
select ok((select state='secured' and next_task='resolved' and customer_journey ->> 'nextState'='resolved'
  and published_report is not null and response_intake is null and jsonb_array_length(negotiation_history)=1
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'closed claim resumes as entitled read-only workspace with prior outbound history');
select ok(public.total_loss_customer_report_access_internal('b2000000-0000-4000-8000-000000000001',
  'bd000000-0000-4000-8000-000000000001'),'closure preserves existing paid report download authorization');
select is(public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',
  (select request_id from resolution_request),'RESOLVED_WITH_INSURER',(select expected_revision from resolution_request))->'resolution',
  (select case_resolution from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'exact confirmation retry is idempotent');
select is((select count(*) from public.total_loss_workflow_events
  where case_id='b2000000-0000-4000-8000-000000000001' and event_type='case.customer_resolution_confirmed'),1::bigint,
  'duplicate closure leaves one immutable resolution event');
select throws_ok($$select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',
  (select request_id from resolution_request),'CUSTOMER_STOPPED_PURSUING',(select expected_revision from resolution_request))$$,
  '55000','Client request identity was already used.','same request cannot change the resolution outcome');
select throws_ok($$select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',
  gen_random_uuid(),'CUSTOMER_STOPPED_PURSUING',(select expected_revision from resolution_request))$$,
  '55000','This case has already been closed. Review its saved outcome.','competing closure is a non-retriable conflict');
select is(pg_temp.resolution_error(gen_random_uuid(),'CUSTOMER_STOPPED_PURSUING',
  (select expected_revision from resolution_request)),
  jsonb_build_object('code','55000','message','This case has already been closed. Review its saved outcome.',
    'detail','CASE_ALREADY_RESOLVED'),'terminal conflict retains its stable application tag despite stale revision');
select is(pg_temp.resolution_error(gen_random_uuid(),'RESOLVED_WITH_INSURER',
  (select expected_revision+1 from resolution_request))->>'detail','CASE_ALREADY_RESOLVED',
  'same outcome with a different request identity is not an exact replay');
select is(pg_temp.resolution_error(gen_random_uuid(),'ACCEPTED_VERIFIED_OFFER',
  (select expected_revision from resolution_request),gen_random_uuid(),gen_random_uuid())->>'detail','CASE_ALREADY_RESOLVED',
  'stale Accept after another terminal outcome receives the terminal conflict');
select ok((select to_jsonb(workflow)=(select original.workflow from original_closed_state original)
  from public.total_loss_claim_workflows workflow where case_id='b2000000-0000-4000-8000-000000000001')
  and (select jsonb_agg(to_jsonb(event) order by id)=(select original.events from original_closed_state original)
    from public.total_loss_workflow_events event where case_id='b2000000-0000-4000-8000-000000000001'),
  'exact replay and rejected terminal requests preserve resolved timestamp revision details and all prior events');
select throws_ok($$select public.record_total_loss_insurer_response('b2000000-0000-4000-8000-000000000001',
  gen_random_uuid(),'A new response',null,null,null,null,1,'be300000-0000-4000-8000-000000000001')$$,
  '55000','This case is closed and read-only.','closed case rejects response mutation endpoint');
select throws_ok($$select public.prepare_total_loss_insurer_response_upload('b2000000-0000-4000-8000-000000000001',
  gen_random_uuid(),'response.pdf','application/pdf',100,repeat('a',64),1)$$,
  '55000','This case is closed and read-only.','closed case rejects upload permits');
select throws_ok($$select public.record_total_loss_insurer_response_decision('b2000000-0000-4000-8000-000000000001',
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'CONTINUE_CHALLENGING',null,1)$$,
  '55000','This case is closed and read-only.','closed case rejects further decisions');
select throws_ok($$select public.prepare_total_loss_customer_message('b2000000-0000-4000-8000-000000000001',
  gen_random_uuid(),1)$$,'55000','This case is closed and read-only.','closed case rejects initial message preparation');
select throws_ok($$select public.confirm_total_loss_customer_message_sent('b2000000-0000-4000-8000-000000000001',
  gen_random_uuid(),gen_random_uuid(),1,true)$$,'55000','This case is closed and read-only.','closed case rejects sent confirmation');
select throws_ok($$select public.confirm_total_loss_customer_follow_up_sent('b2000000-0000-4000-8000-000000000001',
  gen_random_uuid(),gen_random_uuid(),1,true)$$,'55000','This case is closed and read-only.','closed case rejects follow-up sent confirmation');
select throws_ok($$select public.retry_total_loss_insurer_response_analysis('b2000000-0000-4000-8000-000000000001',
  gen_random_uuid(),1)$$,'55000','This case is closed and read-only.','closed case rejects analysis retry');
select throws_ok($$update public.total_loss_message_drafts set body='Changed after closure'
  where case_id='b2000000-0000-4000-8000-000000000001'$$,
  '55000','This case is closed and read-only.','database guard rejects even trusted draft writes');
select throws_ok($$update public.total_loss_claim_workflows set revision=revision+1
  where case_id='b2000000-0000-4000-8000-000000000001'$$,
  '55000','This case is closed and read-only.','terminal workflow cannot progress or reopen');
update public.case_entitlements set status='revoked',revoked_at=statement_timestamp(),reason_code='CUSTOMER_REFUND' where id='b8000000-0000-4000-8000-000000000001';
select ok(not public.total_loss_customer_report_access_internal('b2000000-0000-4000-8000-000000000001',
  'bd000000-0000-4000-8000-000000000001'),'financial access revocation still applies after closure');
select ok((select case_resolution is null and published_report is null and negotiation_history is null and next_task='purchase_unavailable'
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'closed workspace does not bypass a revoked entitlement');
rollback to manual_resolution;

savepoint manual_amount;
create temporary table manual_amount_request as select gen_random_uuid() as request_id,
  revision as expected_revision from public.total_loss_claim_workflows where case_id='b2000000-0000-4000-8000-000000000001';
select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',(select request_id from manual_amount_request),
  'RESOLVED_WITH_INSURER',(select expected_revision from manual_amount_request),
  null,null,2134567,'USD');
select ok((select case_resolution ->> 'amountMinorUnits'='2134567' and case_resolution ->> 'currency'='USD'
  and case_resolution ->> 'amountSource'='CUSTOMER_REPORTED' and case_resolution ->> 'offerId' is null
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'optional final amount retains customer-reported provenance without an insurer offer');
select is((select count(*) from public.total_loss_offers
  where case_id='b2000000-0000-4000-8000-000000000001'),0::bigint,'manual amount does not create insurer evidence');
select is(public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',
  (select request_id from manual_amount_request),'RESOLVED_WITH_INSURER',(select expected_revision from manual_amount_request),
  null,null,2134567,'USD')->'resolution',
  (select case_resolution from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'exact manual amount and currency replay retains its original customer-reported provenance');
select is(pg_temp.resolution_error((select request_id from manual_amount_request),'RESOLVED_WITH_INSURER',
  (select expected_revision from manual_amount_request),null,null,2134568,'USD')->>'message',
  'Client request identity was already used.','reused request cannot change the manual amount');
select is(pg_temp.resolution_error((select request_id from manual_amount_request),'RESOLVED_WITH_INSURER',
  (select expected_revision from manual_amount_request),null,null,2134567,'CAD')->>'message',
  'Client request identity was already used.','reused request cannot change the manual currency');
rollback to manual_amount;

savepoint stopped;
select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'CUSTOMER_STOPPED_PURSUING',(select revision from public.total_loss_claim_workflows where case_id='b2000000-0000-4000-8000-000000000001'));
select ok((select case_resolution ->> 'code'='CUSTOMER_STOPPED_PURSUING'
  and case_resolution ->> 'amountMinorUnits' is null and case_resolution ->> 'offerId' is null
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'stopping pursuit records a separate terminal outcome without settlement evidence');
rollback to stopped;

savepoint closure_authorization;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'CUSTOMER_STOPPED_PURSUING',4)$$,'42501','Case resolution is unavailable.','another owner cannot close a case');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
update public.case_entitlements set status='suspended' where id='b8000000-0000-4000-8000-000000000001';
select throws_ok($$select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'CUSTOMER_STOPPED_PURSUING',4)$$,'42501','Case resolution is unavailable.','suspended entitlement cannot close a case');
rollback to closure_authorization;

select throws_ok($$select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'RESOLVED_WITH_INSURER',1)$$,'55000','Claim workflow changed before case resolution.','stale workflow revision is a non-retriable conflict');
select throws_ok($$select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'CUSTOMER_STOPPED_PURSUING',4,null,null,2000000,'USD')$$,'22023','Case resolution confirmation is invalid.',
  'stopped pursuit cannot silently carry a settlement amount');

savepoint no_dispute_outcome;
update public.total_loss_claim_workflows set phase='resolution',current_task='no_dispute_resolved',
  resolution_code='NO_DISPUTE_SUPPORTED',resolved_at=statement_timestamp(),revision=revision+1
  where case_id='b2000000-0000-4000-8000-000000000001';
select ok((select customer_journey ->> 'nextState'='no_dispute'
  and case_resolution ->> 'code'='NO_DISPUTE_SUPPORTED' and case_resolution ->> 'customerConfirmed'='false'
  and case_resolution ->> 'clientRequestId' is null and published_report is not null
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'existing no-dispute resolution keeps its established journey and distinct system provenance');
select ok((select case_status='closed' and case_stage='closed' from public.list_owned_case_operations()
  where case_id='b2000000-0000-4000-8000-000000000001'),'legacy no-dispute resolution is historical in the lightweight owned list');
select is(pg_temp.resolution_error(gen_random_uuid(),'RESOLVED_WITH_INSURER',1)->>'detail','CASE_ALREADY_RESOLVED',
  'customer closure cannot replace the distinct system no-dispute outcome');
rollback to no_dispute_outcome;

-- A literal amount in saved response text keeps response-material provenance.
savepoint response_text_acceptance;
create temporary table response_text_source as select public.record_total_loss_insurer_response(
  'b2000000-0000-4000-8000-000000000001',gen_random_uuid(),'The revised insurer offer is $20,500.00.',null,
  null,null,null,(select revision from public.total_loss_claim_workflows where case_id='b2000000-0000-4000-8000-000000000001'),
  'be300000-0000-4000-8000-000000000001') as response;
update pg_temp.valid_result set result=jsonb_set(result,'{revisedOffer}',jsonb_build_object(
  'status','PRESENT','amountMinorUnits',2050000,'currency','USD','source','INSURER_RESPONSE','visualSourceInterpretation',null,
  'responseEvidenceRefs',jsonb_build_array('response_'||repeat('a',64))));
update pg_temp.valid_evidence_index set evidence_index=jsonb_set(evidence_index,'{responseEvidence,0,content}',
  to_jsonb('The revised insurer offer is $20,500.00.'::text));
select pg_temp.complete_response(pg_temp.recommendation('NO_CLEAR_RECOMMENDATION','RESPONSE_TEXT'));
create temporary table response_text_decision as select public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001',gen_random_uuid(),
  (select response#>>'{response,responseId}' from response_text_source)::uuid,
  workflow.current_recommendation_id,'ACCEPT_OFFER',workflow.current_offer_id,workflow.revision) as decision
  from public.total_loss_claim_workflows workflow where case_id='b2000000-0000-4000-8000-000000000001';
create temporary table response_text_confirmation as select gen_random_uuid() as request_id,revision as expected_revision,
  (select decision#>>'{response,decision,decisionId}' from response_text_decision)::uuid as decision_id,current_offer_id as offer_id
  from public.total_loss_claim_workflows where case_id='b2000000-0000-4000-8000-000000000001';
select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',
  (select request_id from response_text_confirmation),'ACCEPTED_VERIFIED_OFFER',
  (select expected_revision from response_text_confirmation),(select decision_id from response_text_confirmation),
  (select offer_id from response_text_confirmation));
select ok((select case_resolution ->> 'amountSource'='RESPONSE_TEXT'
  and case_resolution ->> 'offerId'=(select offer_id::text from response_text_confirmation)
  and case_resolution ->> 'decisionId'=(select decision_id::text from response_text_confirmation)
  and insurer_response#>>'{usableOffer,source}'='RESPONSE_TEXT'
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'accepted literal response-text offer preserves its source and exact identity through closure');
rollback to response_text_acceptance;

-- The exact accepted offer is available only after a current analyzed response.
create temporary table accepted_source as select public.record_total_loss_insurer_response(
  'b2000000-0000-4000-8000-000000000001',gen_random_uuid(),'The revised insurer offer is $20,500.00.',2050000,
  null,null,null,(select revision from public.total_loss_claim_workflows where case_id='b2000000-0000-4000-8000-000000000001'),
  'be300000-0000-4000-8000-000000000001') as response;
select throws_ok($$select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'CUSTOMER_STOPPED_PURSUING',(select revision from public.total_loss_claim_workflows where case_id='b2000000-0000-4000-8000-000000000001'))$$,
  '55000','Wait for the current insurer response review before closing this case.','pending analysis prevents inconsistent closure');
update pg_temp.valid_result set result=jsonb_set(result,'{revisedOffer}',jsonb_build_object(
  'status','PRESENT','amountMinorUnits',2050000,'currency','USD','source','CUSTOMER_SUPPLIED','visualSourceInterpretation',null,
  'responseEvidenceRefs',jsonb_build_array('response_'||repeat('a',64))));
select pg_temp.complete_response(pg_temp.recommendation('NO_CLEAR_RECOMMENDATION'));
create temporary table accepted_decision as select public.record_total_loss_insurer_response_decision(
  'b2000000-0000-4000-8000-000000000001',gen_random_uuid(),(select response#>>'{response,responseId}' from accepted_source)::uuid,
  workflow.current_recommendation_id,'ACCEPT_OFFER',workflow.current_offer_id,workflow.revision) as decision
  from public.total_loss_claim_workflows workflow where case_id='b2000000-0000-4000-8000-000000000001';
select ok((select resolution_code is null and resolved_at is null and phase='negotiation'
  from public.total_loss_claim_workflows where case_id='b2000000-0000-4000-8000-000000000001'),
  'clicking Accept records only a decision and does not close');
create temporary table accepted_confirmation as select gen_random_uuid() as request_id,revision as expected_revision,
  (select decision#>>'{response,decision,decisionId}' from accepted_decision)::uuid as decision_id,current_offer_id as offer_id
  from public.total_loss_claim_workflows where case_id='b2000000-0000-4000-8000-000000000001';
select throws_ok($$select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'ACCEPTED_VERIFIED_OFFER',(select expected_revision from accepted_confirmation),gen_random_uuid(),
  (select offer_id from accepted_confirmation))$$,'55000','The accepted offer or customer decision is no longer current.',
  'unrelated Accept identity cannot close the current case');

savepoint correction;
select public.record_total_loss_insurer_response('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'Corrected response: the revised insurer offer is $20,500.00.',null,null,null,
  (select response#>>'{response,responseId}' from accepted_source)::uuid,
  (select expected_revision from accepted_confirmation),'be300000-0000-4000-8000-000000000001');
select throws_ok($$select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',
  (select request_id from accepted_confirmation),'ACCEPTED_VERIFIED_OFFER',(select expected_revision from accepted_confirmation),
  (select decision_id from accepted_confirmation),(select offer_id from accepted_confirmation))$$,
  '55000','Claim workflow changed before case resolution.','stale tab cannot close after correction supersedes Accept');
update pg_temp.valid_result set result=jsonb_set(result,'{revisedOffer}',jsonb_build_object(
  'status','PRESENT','amountMinorUnits',2050000,'currency','USD','source','INSURER_RESPONSE','visualSourceInterpretation',null,
  'responseEvidenceRefs',jsonb_build_array('response_'||repeat('a',64))));
update pg_temp.valid_evidence_index set evidence_index=jsonb_set(evidence_index,'{responseEvidence,0,content}',
  to_jsonb('Corrected response: the revised insurer offer is $20,500.00.'::text));
select pg_temp.complete_response(pg_temp.recommendation('NO_CLEAR_RECOMMENDATION','RESPONSE_TEXT'));
select ok((select insurer_response#>>'{usableOffer,source}'='RESPONSE_TEXT'
  and exists(select 1 from jsonb_array_elements(negotiation_history) round(value)
    cross join lateral jsonb_array_elements(round.value -> 'responses') response(value)
    where response.value ->> 'responseId'=(select response#>>'{response,responseId}' from accepted_source)
      and response.value#>>'{usableOffer,source}'='CUSTOMER_RECORDED')
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'corrected response uses its current source while historical offer provenance remains unchanged');
select throws_ok($$select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'ACCEPTED_VERIFIED_OFFER',(select revision from public.total_loss_claim_workflows where case_id='b2000000-0000-4000-8000-000000000001'),
  (select decision_id from accepted_confirmation),(select offer_id from accepted_confirmation))$$,
  '55000','The accepted offer or customer decision is no longer current.','superseded Accept cannot close even with refreshed revision');
rollback to correction;

select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',
  (select request_id from accepted_confirmation),'ACCEPTED_VERIFIED_OFFER',(select expected_revision from accepted_confirmation),
  (select decision_id from accepted_confirmation),(select offer_id from accepted_confirmation));
select ok((select case_resolution ->> 'code'='ACCEPTED_VERIFIED_OFFER'
  and case_resolution ->> 'offerId'=(select offer_id::text from accepted_confirmation)
  and case_resolution ->> 'decisionId'=(select decision_id::text from accepted_confirmation)
  and case_resolution ->> 'recommendationId'=insurer_response#>>'{decision,recommendationId}'
  and case_resolution ->> 'responseId'=insurer_response ->> 'responseId'
  and case_resolution ->> 'amountMinorUnits'='2050000' and case_resolution ->> 'currency'='USD'
  and case_resolution ->> 'amountSource'='CUSTOMER_RECORDED'
  and case_resolution ->> 'customerConfirmed'='true'
  and insurer_response ->> 'canCorrect'='false' and jsonb_array_length(negotiation_history)=1
  from public.resolve_total_loss_case_claim('b2000000-0000-4000-8000-000000000001')),
  'explicit accepted confirmation retains exact offer decision recommendation response and amount provenance');
select is(public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',
  (select request_id from accepted_confirmation),'ACCEPTED_VERIFIED_OFFER',(select expected_revision from accepted_confirmation),
  (select decision_id from accepted_confirmation),(select offer_id from accepted_confirmation))->>'workflowRevision',
  (select (expected_revision+1)::text from accepted_confirmation),'accepted duplicate confirmation does not increment terminal revision');
select throws_ok($$select public.confirm_total_loss_case_resolution('b2000000-0000-4000-8000-000000000001',
  (select request_id from accepted_confirmation),'ACCEPTED_VERIFIED_OFFER',(select expected_revision+1 from accepted_confirmation),
  (select decision_id from accepted_confirmation),(select offer_id from accepted_confirmation))$$,
  '55000','Client request identity was already used.','idempotency identity includes exact submitted revision');
select is(pg_temp.resolution_error((select request_id from accepted_confirmation),'ACCEPTED_VERIFIED_OFFER',
  (select expected_revision from accepted_confirmation),gen_random_uuid(),(select offer_id from accepted_confirmation))->>'message',
  'Client request identity was already used.','accepted replay cannot substitute a different decision');
select is(pg_temp.resolution_error((select request_id from accepted_confirmation),'ACCEPTED_VERIFIED_OFFER',
  (select expected_revision from accepted_confirmation),(select decision_id from accepted_confirmation),gen_random_uuid())->>'message',
  'Client request identity was already used.','accepted replay cannot substitute a different offer');
select is(pg_temp.resolution_error(gen_random_uuid(),'CUSTOMER_STOPPED_PURSUING',
  (select expected_revision+1 from accepted_confirmation))->>'detail','CASE_ALREADY_RESOLVED',
  'another terminal request cannot overwrite accepted offer closure');
select ok(not has_function_privilege('anon','public.confirm_total_loss_case_resolution(uuid,uuid,text,bigint,uuid,uuid,bigint,text)','EXECUTE')
  and not has_function_privilege('service_role','public.confirm_total_loss_case_resolution(uuid,uuid,text,bigint,uuid,uuid,bigint,text)','EXECUTE')
  and has_function_privilege('authenticated','public.confirm_total_loss_case_resolution(uuid,uuid,text,bigint,uuid,uuid,bigint,text)','EXECUTE'),
  'closure is a customer RPC with no anonymous or worker execution grant');
select * from finish();
rollback;
