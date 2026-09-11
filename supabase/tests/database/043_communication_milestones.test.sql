begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
set local venfour.test.response_intake_mode='report';

-- Paid lineage fixture shared in shape with 031_total_loss_response_vehicle_context.
-- No email providers are contacted; this entire test rolls back.
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

update communication_settings set enrolled_after=statement_timestamp()-interval '1 day';
select is((select count(*)::int from communication_candidates_internal() where template_key='free_review_ready'),1,'verified non-guest free result eligible');
update total_loss_analysis_jobs set started_as_guest=true where id='b4000000-0000-4000-8000-000000000001';
select is((select count(*)::int from communication_candidates_internal() where template_key='free_review_ready'),0,'guest-origin result excluded from duplicate ready producer');
update total_loss_analysis_jobs set started_as_guest=false where id='b4000000-0000-4000-8000-000000000001';
select is((select count(*)::int from communication_candidates_internal() where template_key='free_review_reminder'),0,'optional free reminder needs consent');
update total_loss_case_contacts set operational_follow_up_allowed=true where case_id='b2000000-0000-4000-8000-000000000001';
select is((select count(*)::int from communication_candidates_internal() where template_key='free_review_reminder'),1,'free reminder becomes eligible with explicit consent');

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

update communication_settings set mode='live',enrolled_after=statement_timestamp()-interval '1 day';
update total_loss_case_contacts set operational_follow_up_allowed=true where case_id='b2000000-0000-4000-8000-000000000001';
update total_loss_claim_workflows set current_task='purchase_complete',revision=revision+1 where case_id='b2000000-0000-4000-8000-000000000001';
select is((select count(*)::int from communication_candidates_internal() where template_key='paid_review_started'),1,'confirmed payment with entitlement creates preparation milestone');
select is((select eligible_at from communication_candidates_internal() where template_key='paid_review_started'),(select paid_at+interval '5 minutes' from commerce_orders where id='b7000000-0000-4000-8000-000000000001'),'payment start coalesces for five minutes');
select is((select count(*)::int from communication_candidates_internal() where template_key like 'free_review%'),0,'purchase cancels free-review reminders');
update total_loss_claim_workflows set current_task='report_ready',current_report_version_id='bd000000-0000-4000-8000-000000000001',revision=revision+1 where case_id='b2000000-0000-4000-8000-000000000001';
select ok(public.total_loss_customer_report_access_for_user_internal('b2000000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001'),'fixture retains real published-report access');
select is((select count(*)::int from communication_candidates_internal() where template_key='paid_review_ready'),1,'published accessible current report creates ready milestone');
select is((select count(*)::int from communication_candidates_internal() where template_key='paid_review_started'),0,'completed report cancels pending preparation message');
select is(communication_worker('discover')->>'queued','1','ready report queues once');
select is(communication_worker('discover')->>'queued','0','same report cannot queue twice');
update total_loss_claim_workflows set current_task='report_generating',current_report_version_id=null,revision=revision+1 where case_id='b2000000-0000-4000-8000-000000000001';
select is((select count(*)::int from communication_candidates_internal() where template_key='paid_review_ready'),0,'older published report alone does not authorize ready mail');
select communication_worker('discover');
select is((select status from communication_deliveries where template_key='paid_review_ready'),'cancelled','current report removal cancels queued message');
update total_loss_claim_workflows set current_task='prepare_request',phase='initial_request',current_report_version_id='bd000000-0000-4000-8000-000000000001',revision=revision+1 where case_id='b2000000-0000-4000-8000-000000000001';
-- The real initial request has no negotiation round or source_draft_revision.
insert into total_loss_message_drafts(id,case_id,report_version_id,purpose,recipient,subject,body)
values('d1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000001','initial_reconsideration','adjuster@example.test','Fictional request','Fictional body');
insert into total_loss_message_versions(id,case_id,message_draft_id,report_version_id,version_number,message_state,purpose,recipient,subject,body,message_digest,created_at)
values('d2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','bd000000-0000-4000-8000-000000000001',1,'prepared','initial_reconsideration','adjuster@example.test','Fictional request','Fictional body',repeat('a',64),statement_timestamp()-interval '49 hours');
update appraisal_cases set last_activity_at=statement_timestamp()-interval '49 hours' where id='b2000000-0000-4000-8000-000000000001';
select is((select entity_id from communication_candidates_internal() where template_key='request_reminder'),'d1000000-0000-4000-8000-000000000001'::uuid,'initial request without a round is eligible using stable draft identity');
select ok((select eligible_at<=statement_timestamp() from communication_candidates_internal() where template_key='request_reminder'),'initial prepared request becomes due after 48 hours');
select is(communication_worker('discover')->>'queued','1','initial unsent request queued');
update total_loss_message_drafts set body='Customer edited this',revision=revision+1 where id='d1000000-0000-4000-8000-000000000001';
select is((select count(*)::int from communication_candidates_internal() where template_key='request_reminder'),0,'editing initial draft cancels old prepared content');
select communication_worker('discover');
select is((select status from communication_deliveries where template_key='request_reminder'),'cancelled','unsent request cancellation durable');

-- The existing sent fixture establishes a real negotiation round.
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
  repeat('9', 64), statement_timestamp()-interval '15 days'
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


select is((select count(*)::int from communication_candidates_internal() where template_key in ('insurer_waiting_reminder','insurer_no_response_reminder')),2,'waiting round has seven and fourteen day milestones');
select is((select eligible_at from communication_candidates_internal() where template_key='insurer_no_response_reminder')-(select eligible_at from communication_candidates_internal() where template_key='insurer_waiting_reminder'),interval '7 days','final check-in is a week after first check-in');
select is((select count(*)::int from communication_candidates_internal() where template_key='request_reminder'),0,'sent initial request is no longer an unsent candidate');
select is(communication_worker('discover')->>'queued','1','outage skips stale seven-day reminder and queues only current fourteen-day reminder');
create temp table milestone_lease as select communication_worker('lease',jsonb_build_object('lease_token',gen_random_uuid())) value;
select is((select value->>'template_key' from milestone_lease),'insurer_no_response_reminder','only current no-response reminder leased');
select set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('venfour.test.email_workflow_revision',(select revision::text from total_loss_claim_workflows where case_id='b2000000-0000-4000-8000-000000000001'),true);
set local role authenticated;
select public.record_total_loss_insurer_response('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),
 'The insurer sent a new response.',null,null,null,null,
 current_setting('venfour.test.email_workflow_revision')::bigint);
reset role;
select is((select count(*)::int from communication_candidates_internal() where template_key in ('insurer_waiting_reminder','insurer_no_response_reminder')),0,'actual response recording cancels both waiting reminders');
select is(communication_worker('prepare',jsonb_build_object('id',(select value->>'id' from milestone_lease),'lease_token',(select value->>'lease_token' from milestone_lease),'prepared_payload','{}'::jsonb,'provider','resend')),null::jsonb,'progress after lease cancels immediately before provider send');
select is((select count(*)::int from communication_candidates_internal() where template_key='response_review_ready'),0,'pending response analysis cannot announce ready');
-- Complete the actual durable response job using the established structured fixture.
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


create temporary table response_claim as select * from public.claim_current_total_loss_insurer_response_analysis(
 'b2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','analysis-provider','response-model-v1','1','1','1');
select * from public.resolve_total_loss_insurer_response_analysis_context((select job_id from response_claim),'d3000000-0000-4000-8000-000000000001');
select * from public.complete_total_loss_insurer_response_analysis(
 (select job_id from response_claim),'d3000000-0000-4000-8000-000000000001',(select run_id from response_claim),'response-model-v1',repeat('c',64),
 (select result from valid_result),public.total_loss_canonical_jsonb_digest((select result from valid_result)),
 '{}',null,null,null,null,(select evidence_index from valid_evidence_index),public.total_loss_canonical_jsonb_digest((select evidence_index from valid_evidence_index)));
select is((select count(*)::int from communication_candidates_internal() where template_key='response_review_ready'),1,'completed current response analysis announces ready');
select is(communication_worker('discover')->>'queued','1','response ready queued once');
select is(communication_worker('discover')->>'queued','0','completed job cannot announce twice');
select set_config('venfour.test.email_response_id',(select response_communication_id::text from total_loss_insurer_response_analysis_jobs where id=(select job_id from response_claim)),true);
select set_config('venfour.test.email_workflow_revision',(select revision::text from total_loss_claim_workflows where case_id='b2000000-0000-4000-8000-000000000001'),true);
set local role authenticated;
select public.record_total_loss_insurer_response('b2000000-0000-4000-8000-000000000001',gen_random_uuid(),
 'The corrected insurer response.',null,null,null,current_setting('venfour.test.email_response_id')::uuid,current_setting('venfour.test.email_workflow_revision')::bigint);
reset role;
select is((select count(*)::int from communication_candidates_internal() where template_key='response_review_ready'),0,'superseding the response removes old completion candidate');
select communication_worker('discover');
select is((select status from communication_deliveries where template_key='response_review_ready'),'cancelled','response correction cancels queued ready email');

update total_loss_claim_workflows set current_task='accept_offer',revision=revision+1 where case_id='b2000000-0000-4000-8000-000000000001';
select is((select count(*)::int from communication_candidates_internal() where template_key='case_closed'),0,'offer acceptance task is not case closure');
update total_loss_claim_workflows set phase='resolution',current_task='resolved',resolution_code='CUSTOMER_CONFIRMED_RESOLVED',resolved_at=statement_timestamp(),revision=revision+1 where case_id='b2000000-0000-4000-8000-000000000001';
select is((select count(*)::int from communication_candidates_internal() where template_key='case_closed'),1,'explicit resolved state has one closure milestone');
select is((select count(*)::int from communication_candidates_internal() where template_key<>'case_closed'),0,'resolved case has no pending progress or reminder candidates');
select * from finish();
rollback;
