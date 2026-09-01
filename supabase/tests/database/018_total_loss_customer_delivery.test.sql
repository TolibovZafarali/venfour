begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(48);

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values
  ('f1000000-0000-4000-8000-000000000001', 'delivery-owner@example.test', statement_timestamp(), false),
  ('f1000000-0000-4000-8000-000000000002', 'delivery-other@example.test', statement_timestamp(), false),
  ('f1000000-0000-4000-8000-000000000003', 'delivery-anonymous@example.test', null, true);

insert into public.appraisal_cases (id, user_id, service_type, status)
values (
  'f2000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001',
  'total_loss', 'check_complete'
);

insert into public.total_loss_case_details (
  case_id, intake_mode, vin, vehicle_year, vehicle_make, vehicle_model,
  vehicle_trim, mileage_at_loss, postal_code, date_of_loss, insurer_name,
  insurer_vehicle_valuation, intake_completed_at, analysis_input_revision,
  analysis_input_id
) values (
  'f2000000-0000-4000-8000-000000000001', 'manual',
  '1HGCM82633A004352', 2022, 'Honda', 'Accord', 'EX-L', 32000,
  '60601', '2026-08-20', 'Example Insurance', 18000,
  statement_timestamp(), 1, 'f3000000-0000-4000-8000-000000000001'
);

insert into public.total_loss_case_contacts (
  case_id, full_name, email, service_terms_version,
  service_terms_acknowledged_at, privacy_notice_version,
  privacy_notice_acknowledged_at, operational_follow_up_allowed,
  operational_follow_up_updated_at
) values (
  'f2000000-0000-4000-8000-000000000001', 'Delivery Customer',
  'delivery-owner@example.test', '2026-08-23', statement_timestamp(),
  '2026-08-23', statement_timestamp(), false, statement_timestamp()
);

insert into public.total_loss_analysis_jobs (
  id, case_id, source_details_updated_at, status, attempt_count,
  processing_token, run_id, finished_at, source_intake_mode,
  source_analysis_input_revision, source_analysis_input_id
) values (
  'f4000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001', statement_timestamp(),
  'completed', 1, gen_random_uuid(),
  'f5000000-0000-4000-8000-000000000001', statement_timestamp(),
  'manual', 1, 'f3000000-0000-4000-8000-000000000001'
);

insert into public.analysis_runs (
  id, job_id, case_id, artifact, request_digest,
  analysis_run_schema_version, analysis_version,
  discrepancy_analysis_version, comparable_scoring_version
) values (
  'f5000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'runId', 'f5000000-0000-4000-8000-000000000001',
    'result', jsonb_build_object(
      'discrepancyResult', jsonb_build_object(
        'classification', 'MATERIAL_UNDERVALUE_SIGNAL'
      )
    )
  ), repeat('1', 64), '4', '4', '1', '1'
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
  'f6000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000001',
  'f5000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001', 'manual', 1,
  'f3000000-0000-4000-8000-000000000001',
  'MATERIAL_UNDERVALUE_SIGNAL', 1800000, 2000000, 2100000, 2200000,
  'USD', '4', '4', '1', '1', '1', '1',
  jsonb_build_object('analysisRunId', 'f5000000-0000-4000-8000-000000000001'),
  jsonb_build_object('classification', 'MATERIAL_UNDERVALUE_SIGNAL'),
  repeat('2', 64)
);

insert into public.total_loss_claim_workflows (
  case_id, preliminary_snapshot_id, phase, current_task
) values (
  'f2000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001',
  'review', 'awaiting_report_generation'
);

-- A permanent owner's otherwise eligible pre-Continue case deliberately has no
-- post-Continue workflow row. M6 must preserve its legacy secured projection.
insert into public.appraisal_cases (id, user_id, service_type, status)
values (
  'd2000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001',
  'total_loss', 'check_complete'
);

insert into public.total_loss_case_details (
  case_id, intake_mode, vin, vehicle_year, vehicle_make, vehicle_model,
  vehicle_trim, mileage_at_loss, postal_code, date_of_loss, insurer_name,
  insurer_vehicle_valuation, intake_completed_at, analysis_input_revision,
  analysis_input_id
) values (
  'd2000000-0000-4000-8000-000000000001', 'manual',
  '1HGCM82633A004352', 2022, 'Honda', 'Accord', 'EX-L', 32000,
  '60601', '2026-08-20', 'Example Insurance', 18000,
  statement_timestamp(), 1, 'd3000000-0000-4000-8000-000000000001'
);

insert into public.total_loss_case_contacts (
  case_id, full_name, email, service_terms_version,
  service_terms_acknowledged_at, privacy_notice_version,
  privacy_notice_acknowledged_at, operational_follow_up_allowed,
  operational_follow_up_updated_at
) values (
  'd2000000-0000-4000-8000-000000000001', 'Legacy Customer',
  'delivery-owner@example.test', '2026-08-23', statement_timestamp(),
  '2026-08-23', statement_timestamp(), false, statement_timestamp()
);

insert into public.total_loss_analysis_jobs (
  id, case_id, source_details_updated_at, status, attempt_count,
  processing_token, run_id, finished_at, source_intake_mode,
  source_analysis_input_revision, source_analysis_input_id
) values (
  'd4000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001', statement_timestamp(),
  'completed', 1, gen_random_uuid(),
  'd5000000-0000-4000-8000-000000000001', statement_timestamp(),
  'manual', 1, 'd3000000-0000-4000-8000-000000000001'
);

insert into public.analysis_runs (
  id, job_id, case_id, artifact, request_digest,
  analysis_run_schema_version, analysis_version,
  discrepancy_analysis_version, comparable_scoring_version
) values (
  'd5000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'runId', 'd5000000-0000-4000-8000-000000000001',
    'result', jsonb_build_object(
      'discrepancyResult', jsonb_build_object(
        'classification', 'MATERIAL_UNDERVALUE_SIGNAL'
      )
    )
  ), repeat('9', 64), '4', '4', '1', '1'
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
  'd6000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001',
  'd5000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001', 'manual', 1,
  'd3000000-0000-4000-8000-000000000001',
  'MATERIAL_UNDERVALUE_SIGNAL', 1800000, 2000000, 2100000, 2200000,
  'USD', '4', '4', '1', '1', '1', '1',
  jsonb_build_object('analysisRunId', 'd5000000-0000-4000-8000-000000000001'),
  jsonb_build_object('classification', 'MATERIAL_UNDERVALUE_SIGNAL'),
  repeat('a', 64)
);

insert into public.commerce_orders (
  id, case_id, purchaser_user_id, preliminary_snapshot_id,
  product_identifier, product_version, amount_minor_units, currency,
  payment_provider, external_price_identifier, provider_livemode,
  purchaser_email, status, terms_version, refund_policy_version, paid_at
) values (
  'f7000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001',
  'total-loss-package', '1', 9900, 'USD', 'stripe',
  'price_test_total_loss_v1', false, 'delivery-owner@example.test',
  'paid', 'terms-1', 'refund-1', statement_timestamp()
);

insert into public.payment_transactions (
  id, case_id, order_id, payment_provider, transaction_kind,
  external_object_id, amount_minor_units, currency, provider_occurred_at
) values (
  'f7100000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'f7000000-0000-4000-8000-000000000001',
  'stripe', 'payment', 'pi_delivery_fixture', 9900, 'USD', statement_timestamp()
);

insert into public.case_entitlements (
  id, case_id, order_id, preliminary_snapshot_id, product_identifier,
  product_version, status
) values (
  'f8000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'f7000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001',
  'total-loss-package', '1', 'active'
);

insert into public.total_loss_package_jobs (
  id, case_id, entitlement_id, preliminary_snapshot_id, status,
  attempt_count, processing_token, started_at, finished_at
) values (
  'f9000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'f8000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001',
  'ready', 1, gen_random_uuid(), statement_timestamp(), statement_timestamp()
);

update public.total_loss_claim_workflows
set current_package_job_id = 'f9000000-0000-4000-8000-000000000001',
    revision = revision + 1
where case_id = 'f2000000-0000-4000-8000-000000000001';

insert into public.total_loss_source_snapshots (
  id, case_id, package_job_id, entitlement_id, preliminary_snapshot_id,
  analysis_job_id, analysis_run_id, owner_user_id_at_creation,
  source_intake_mode, source_analysis_input_revision, source_analysis_input_id,
  extraction_available, analysis_artifact_digest, preliminary_snapshot_digest,
  request_digest, evidence_cutoff, snapshot_created_at,
  analysis_run_schema_version, analysis_version,
  discrepancy_analysis_version, comparable_scoring_version,
  presentation_schema_version, preliminary_snapshot_schema_version,
  snapshot_schema_version, source_snapshot, snapshot_digest
) values (
  'fa000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'f9000000-0000-4000-8000-000000000001',
  'f8000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000001',
  'f5000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000001', 'manual', 1,
  'f3000000-0000-4000-8000-000000000001', false,
  repeat('3', 64), repeat('2', 64), repeat('1', 64),
  '2026-08-20', '2026-08-29T12:00:00Z', '4', '4', '1', '1', '1', '1', '1',
  jsonb_build_object(
    'schemaVersion', '1',
    'validationManifest', jsonb_build_object(
      'validatorVersion', '1', 'checks', jsonb_build_array(),
      'limitations', jsonb_build_array()
    ),
    'snapshotDigest', repeat('4', 64)
  ), repeat('4', 64)
);

insert into public.total_loss_final_assessments (
  id, case_id, package_job_id, preliminary_snapshot_id, source_snapshot_id,
  version_number, conclusion_code, currency,
  supported_range_low_minor_units, supported_range_median_minor_units,
  supported_range_high_minor_units, findings, limitations, reason_codes,
  preliminary_to_final_comparison, assessment, methodology_version,
  schema_version, assessment_digest
) values (
  'fb000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'f9000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001',
  'fa000000-0000-4000-8000-000000000001', 1,
  'MATERIAL_UNDERVALUE_SIGNAL', 'USD', 2000000, 2100000, 2200000,
  jsonb_build_array(), jsonb_build_array(), jsonb_build_array(),
  jsonb_build_object('materialChange', false),
  jsonb_build_object(
    'schemaVersion', '1', 'continuationStatus', 'SUPPORTS_CONTINUATION',
    'assessmentDigest', repeat('6', 64)
  ), '1', '1', repeat('6', 64)
);

insert into public.total_loss_report_series (
  id, case_id, product_identifier, report_kind
) values (
  'fc000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'total-loss-package', 'valuation-evidence-package'
);

create temporary table m6_report_payload (report jsonb) on commit drop;
insert into m6_report_payload values (jsonb_build_object(
  'schemaVersion', '1',
  'identity', jsonb_build_object(
    'caseId', 'f2000000-0000-4000-8000-000000000001',
    'reportSeriesId', 'fc000000-0000-4000-8000-000000000001',
    'reportVersionId', 'fe000000-0000-4000-8000-000000000001',
    'versionNumber', 1, 'versionLabel', 'v1', 'issueDate', '2026-08-29',
    'suggestedFilename', 'Venfour_Valuation_Evidence_F20000000000_v1.pdf'
  ),
  'lineage', jsonb_build_object(
    'provider', 'internal-provider', 'modelIdentifier', 'internal-model',
    'sourceSnapshotId', 'fa000000-0000-4000-8000-000000000001'
  ),
  'evidenceCutoff', jsonb_build_object(
    'lossDate', '2026-08-20', 'currentObservedDate', '2026-08-29',
    'historicalEvidenceDate', null, 'historicalProviderAsOfDate', null
  ),
  'executiveConclusion', jsonb_build_object(
    'classification', 'MATERIAL_UNDERVALUE_SIGNAL',
    'classificationLabel', 'Material undervalue signal',
    'continuationStatus', 'SUPPORTS_CONTINUATION',
    'summary', 'The completed evidence supports a written reconsideration request.',
    'insurerValuation', jsonb_build_object(
      'value', jsonb_build_object(
        'minorUnits', 1800000, 'currency', 'USD', 'display', '$18,000.00'
      )
    ),
    'supportedAdvertisedPriceRange', jsonb_build_object(
      'evidenceBasis', 'CURRENT_MARKET',
      'low', jsonb_build_object(
        'minorUnits', 2000000, 'currency', 'USD', 'display', '$20,000.00'
      ),
      'median', jsonb_build_object(
        'minorUnits', 2100000, 'currency', 'USD', 'display', '$21,000.00'
      ),
      'high', jsonb_build_object(
        'minorUnits', 2200000, 'currency', 'USD', 'display', '$22,000.00'
      )
    )
  ),
  'subjectVehicle', jsonb_build_object(
    'vehicleDisplay', '2022 Honda Accord EX-L', 'vin', '1HGCM82633A004352'
  ),
  'insurerValuationReviewed', jsonb_build_object(
    'insurerName', jsonb_build_object(
      'value', 'Example Insurance', 'displayValue', 'Example Insurance'
    ),
    'source', 'internal-report-provider'
  ),
  'insurerComparableReview', jsonb_build_object(
    'methodologyStatement', 'Every insurer comparable is shown descriptively.',
    'weightingStatus', 'NOT_DETERMINED_BY_V1',
    'summary', jsonb_build_object(
      'totalCount', 1, 'advertisedPriceMissingCount', 0,
      'adjustedValueMissingCount', 0, 'fullyDisclosedAdjustmentCount', 1,
      'partiallyDisclosedAdjustmentCount', 0, 'undisclosedAdjustmentCount', 0,
      'unavailableAdjustmentCount', 0,
      'advertisedPrices', jsonb_build_object(
        'count', 1,
        'minimumPrice', jsonb_build_object('cents', 1980000, 'display', '$19,800.00'),
        'medianPrice', jsonb_build_object('cents', 1980000, 'display', '$19,800.00'),
        'maximumPrice', jsonb_build_object('cents', 1980000, 'display', '$19,800.00')
      ),
      'adjustedValues', jsonb_build_object(
        'count', 1,
        'minimumPrice', jsonb_build_object('cents', 2000000, 'display', '$20,000.00'),
        'medianPrice', jsonb_build_object('cents', 2000000, 'display', '$20,000.00'),
        'maximumPrice', jsonb_build_object('cents', 2000000, 'display', '$20,000.00')
      )
    ),
    'comparables', jsonb_build_array(jsonb_build_object(
      'comparableNumber', 1, 'vehicleDisplay', '2022 Honda Accord EX-L',
      'vin', '1HGCM82633A004352', 'provider', 'internal-provider',
      'mileage', 32000, 'advertisedPrice', '$19,800.00',
      'adjustedValue', '$20,000.00', 'netAdjustment', '$200.00',
      'adjustments', jsonb_build_object(
        'package', '$0.00', 'options', '$0.00',
        'mileage', '$200.00', 'condition', '$0.00'
      ),
      'adjustmentDisclosure', 'Fully disclosed', 'contributionPercent', 100
    ))
  ),
  'independentMarketEvidence', jsonb_build_object(
    'primary', jsonb_build_object(
      'role', 'PRIMARY', 'evidenceBasis', 'CURRENT_MARKET',
      'label', 'Primary current market evidence',
      'description', 'Selected current advertised listings.',
      'provider', 'internal-provider', 'evidenceDate', '2026-08-29',
      'selectedCount', 1,
      'prices', jsonb_build_object(
        'count', 1,
        'minimumPrice', jsonb_build_object('cents', 2100000, 'display', '$21,000.00'),
        'medianPrice', jsonb_build_object('cents', 2100000, 'display', '$21,000.00'),
        'maximumPrice', jsonb_build_object('cents', 2100000, 'display', '$21,000.00')
      )
    ),
    'secondary', null,
    'comparables', jsonb_build_array(jsonb_build_object(
      'role', 'PRIMARY', 'evidenceBasis', 'CURRENT_MARKET',
      'source', 'internal-provider', 'sourceListingId', 'private-listing-id',
      'vin', '1HGCM82633A004352', 'vehicleDisplay', '2022 Honda Accord EX-L',
      'mileage', 31500, 'advertisedPrice', '$21,000.00',
      'dealer', 'Example Motors', 'location', 'Chicago, IL',
      'distanceMiles', 12, 'rank', 1, 'score', 999,
      'evidenceDate', '2026-08-29', 'temporalBasis', 'Current listing'
    ))
  ),
  'adjustmentsAndCalculations', jsonb_build_object(
    'methodologyStatement', 'Only stored deterministic calculations are shown.',
    'calculations', jsonb_build_array(jsonb_build_object(
      'code', 'PRIMARY_EVIDENCE_COMPARISON',
      'values', jsonb_build_array(jsonb_build_object(
        'key', 'difference', 'value', 300000, 'displayValue', '$3,000.00'
      ))
    ))
  ),
  'preliminaryVersusFinal', jsonb_build_object(
    'status', 'CONFIRMED',
    'summary', 'The final assessment confirms the preliminary result.',
    'internalRangeDelta', jsonb_build_object('low', 0, 'high', 0)
  ),
  'assumptionsAndLimitations', jsonb_build_object(
    'limitations', jsonb_build_array(jsonb_build_object(
      'code', 'ADVERTISED_PRICES',
      'description', 'Advertised prices are evidence, not guaranteed transaction prices.'
    ))
  )
));

insert into public.total_loss_claim_documents (
  id, case_id, document_kind, storage_bucket_id, storage_object_name,
  original_filename, media_type, byte_size, content_digest, status, sealed_at
) values (
  'fd000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'valuation_evidence_report', 'case-deliverables',
  'cases/f2000000-0000-4000-8000-000000000001/reports/fc000000-0000-4000-8000-000000000001/versions/fe000000-0000-4000-8000-000000000001/valuation-evidence-package.pdf',
  'valuation-evidence-package.pdf', 'application/pdf', 321, repeat('8', 64),
  'ready', statement_timestamp()
);

insert into storage.objects (id, bucket_id, name, metadata, user_metadata)
values (
  'ff000000-0000-4000-8000-000000000001', 'case-deliverables',
  'cases/f2000000-0000-4000-8000-000000000001/reports/fc000000-0000-4000-8000-000000000001/versions/fe000000-0000-4000-8000-000000000001/valuation-evidence-package.pdf',
  jsonb_build_object('mimetype', 'application/pdf', 'size', 321),
  jsonb_build_object('sha256', repeat('8', 64))
);

insert into public.total_loss_report_versions (
  id, case_id, report_series_id, version_number, final_assessment_id,
  preliminary_snapshot_id, document_id, renderer_version, template_version,
  schema_version, report, report_digest, status, published_at, package_job_id
) select
  'fe000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'fc000000-0000-4000-8000-000000000001', 1,
  'fb000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001',
  'fd000000-0000-4000-8000-000000000001', '1', '1', '1', report,
  repeat('7', 64), 'published', statement_timestamp(),
  'f9000000-0000-4000-8000-000000000001'
from m6_report_payload;

update public.total_loss_report_series
set current_report_version_id = 'fe000000-0000-4000-8000-000000000001',
    current_published_report_version_id = 'fe000000-0000-4000-8000-000000000001'
where id = 'fc000000-0000-4000-8000-000000000001';

update public.total_loss_claim_workflows
set current_report_version_id = 'fe000000-0000-4000-8000-000000000001',
    current_task = 'report_ready', revision = revision + 1
where case_id = 'f2000000-0000-4000-8000-000000000001';

select ok(
  to_regprocedure('public.get_total_loss_customer_reports(uuid,uuid)') is not null
    and to_regprocedure('public.put_total_loss_education_progress(uuid,text,text,bigint)') is not null
    and to_regprocedure('public.put_total_loss_sending_details(uuid,text,text,text,boolean,boolean,bigint,bigint)') is not null
    and to_regprocedure('public.prepare_total_loss_customer_message(uuid,uuid,bigint)') is not null
    and to_regprocedure('public.patch_total_loss_customer_message_draft(uuid,text,text,text,bigint)') is not null
    and to_regprocedure('public.record_total_loss_customer_email_opened(uuid,uuid,uuid)') is not null
    and to_regprocedure('public.confirm_total_loss_customer_message_sent(uuid,uuid,uuid,bigint,boolean)') is not null,
  'the bounded M6 customer RPC surface exists'
);

select ok(
  not has_table_privilege('authenticated', 'public.total_loss_report_versions', 'SELECT')
    and not has_table_privilege('authenticated', 'public.total_loss_claim_documents', 'SELECT')
    and not has_function_privilege('authenticated', 'public.authorize_total_loss_customer_report_download(uuid,uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.authorize_total_loss_deliverable_read(text)', 'EXECUTE')
    and not exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'Owners can read published total-loss deliverables'
    ),
  'browser roles cannot read raw reports, document paths, or list deliverable objects'
);

set local role service_role;

select ok(
  (
    select report_version_id = 'fe000000-0000-4000-8000-000000000001'::uuid
      and storage_bucket_id = 'case-deliverables'
      and storage_object_name like '%/fe000000-0000-4000-8000-000000000001/%'
      and suggested_filename = 'Venfour_Valuation_Evidence_F20000000000_v1.pdf'
    from public.authorize_total_loss_customer_report_download(
      'f2000000-0000-4000-8000-000000000001',
      'fe000000-0000-4000-8000-000000000001',
      'f1000000-0000-4000-8000-000000000001'
    )
  ),
  'the service-only download seam authorizes exactly the current entitled object and friendly filename'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  (
    select count(*) = 1
      and bool_and(
        state = 'secured'
        and workflow_phase is null
        and workflow_current_task is null
        and workflow_revision is null
        and checkout_available = false
        and commerce_order_status is null
        and payment_status is null
        and entitlement_status is null
        and next_task is null
        and commerce_amount_minor_units is null
        and commerce_currency is null
        and customer_journey is null
        and published_report is null
        and education_progress is null
        and sending_details is null
        and message_draft is null
      )
    from public.resolve_total_loss_case_claim(
      'd2000000-0000-4000-8000-000000000001'
    )
  ),
  'an eligible legacy secured case without a workflow keeps its pre-M6 projection and cannot enter checkout'
);

select ok(
  (
    select count(*) = 2
      and bool_and(
        has_total_loss_claim_workflow = (
          case_id = 'f2000000-0000-4000-8000-000000000001'::uuid
        )
      )
    from public.list_owned_case_operations()
    where case_id in (
      'd2000000-0000-4000-8000-000000000001',
      'f2000000-0000-4000-8000-000000000001'
    )
  ),
  'the owned-case list exposes only direct post-Continue workflow existence'
);

reset role;
update public.total_loss_claim_workflows
set
  current_task = current_task,
  revision = revision + 1
where case_id = 'f2000000-0000-4000-8000-000000000001';
select set_config(
  'test.workflow_updated_at',
  (
    select updated_at::text
    from public.total_loss_claim_workflows
    where case_id = 'f2000000-0000-4000-8000-000000000001'
  ),
  true
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (
    select owned_case.last_activity_at::text
    from public.list_owned_case_operations() as owned_case
    where owned_case.case_id = 'f2000000-0000-4000-8000-000000000001'
  ),
  current_setting('test.workflow_updated_at'),
  'the owned-case list orders post-Continue work by effective workflow activity'
);

select ok(
  (
    select state = 'secured'
      and workflow_current_task = 'report_ready'
      and commerce_amount_minor_units = 9900
      and commerce_currency = 'USD'
      and customer_journey ->> 'nextState' = 'guide_result'
      and customer_journey ->> 'fulfillmentState' = 'report_ready'
      and customer_journey -> 'retryable' = 'false'::jsonb
    from public.resolve_total_loss_case_claim(
      'f2000000-0000-4000-8000-000000000001'
    )
  ),
  'the resolver projects paid report-ready state, server price, and a non-null false retry flag'
);

select ok(
  (
    select array(select jsonb_object_keys(report) order by 1) = array[
      'conclusion', 'insurerEvidence', 'issueDate', 'marketEvidence',
      'reportId', 'status', 'subjectVehicle', 'suggestedFilename', 'title',
      'versionLabel', 'versionNumber'
    ]::text[]
    from public.get_total_loss_customer_reports(
      'f2000000-0000-4000-8000-000000000001', null
    )
  ),
  'published report metadata uses an exact customer-safe top-level allowlist'
);

select is(
  (
    select report #> '{marketEvidence,secondary}'
    from public.get_total_loss_customer_reports(
      'f2000000-0000-4000-8000-000000000001', null
    )
  ),
  'null'::jsonb,
  'a missing secondary evidence source remains JSON null instead of an all-null object'
);

select ok(
  (
    select report::text !~* '(provider|modelIdentifier|sourceListingId|vin|storageObject|lineage)'
    from public.get_total_loss_customer_reports(
      'f2000000-0000-4000-8000-000000000001', null
    )
  ),
  'the report projection strips provider identity, model identity, VINs, source listing IDs, storage paths, and lineage'
);

select ok(
  (
    select report #>> '{conclusion,supportedRange,evidenceBasis}' =
        'Current advertised-price evidence'
      and report #> '{conclusion,preliminaryComparison}' = jsonb_build_object(
        'status', 'CONFIRMED',
        'summary', 'The final assessment confirms the preliminary result.'
      )
    from public.get_total_loss_customer_reports(
      'f2000000-0000-4000-8000-000000000001', null
    )
  ),
  'real report evidence codes are mapped to customer language and preliminary comparison exposes only status and summary'
);

select ok(
  (
    select array(select jsonb_object_keys(report #> '{marketEvidence,comparables,0}') order by 1) = array[
      'advertisedPrice', 'dealer', 'distanceMiles', 'evidenceDate', 'location',
      'mileage', 'role', 'temporalBasis', 'vehicle'
    ]::text[]
      and array(select jsonb_object_keys(report #> '{insurerEvidence,comparables,0}') order by 1) = array[
        'adjustedValue', 'adjustmentDisclosure', 'adjustments',
        'advertisedPrice', 'contributionPercent', 'mileage', 'netAdjustment',
        'vehicle'
      ]::text[]
    from public.get_total_loss_customer_reports(
      'f2000000-0000-4000-8000-000000000001', null
    )
  ),
  'market and insurer comparables contain only explicitly allowlisted customer facts'
);

select throws_ok(
  $$
    select public.put_total_loss_education_progress(
      'f2000000-0000-4000-8000-000000000001',
      'insurer_review', 'skipped',
      (select workflow_revision from public.resolve_total_loss_case_claim(
        'f2000000-0000-4000-8000-000000000001'
      ))
    )
  $$,
  '55000',
  'Complete the required result step first.',
  'a tampered optional skip cannot bypass required Screen 1'
);

select throws_ok(
  $$select count(*) from public.total_loss_report_versions$$,
  '42501', null,
  'the owner cannot query raw published report JSON directly'
);

select throws_ok(
  $$select count(*) from public.total_loss_claim_documents$$,
  '42501', null,
  'the owner cannot query raw document metadata or object paths directly'
);

select is(
  (select count(*) from storage.objects where bucket_id = 'case-deliverables'),
  0::bigint,
  'the owner cannot list deliverable object names through Storage RLS'
);

select is(
  (
    (select count(*) from public.total_loss_claim_workflows)
    + (select count(*) from public.case_entitlements)
    + (select count(*) from public.total_loss_report_series)
    + (select count(*) from public.total_loss_message_drafts)
    + (select count(*) from public.total_loss_message_versions)
    + (select count(*) from public.total_loss_communications)
  ),
  0::bigint,
  'the customer cannot bypass resolver and message RPC projections through internal tables'
);

select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', true);

select is(
  (select count(*) from public.resolve_total_loss_case_claim(
    'f2000000-0000-4000-8000-000000000001'
  )),
  0::bigint,
  'a wrong permanent owner receives owner-safe resolver absence'
);

select is(
  (select count(*) from public.get_total_loss_customer_reports(
    'f2000000-0000-4000-8000-000000000001',
    'fe000000-0000-4000-8000-000000000001'
  )),
  0::bigint,
  'a wrong permanent owner cannot read a cross-owner report ID through the RPC'
);

reset role;

update public.case_entitlements
set status = 'suspended', status_changed_at = statement_timestamp()
where id = 'f8000000-0000-4000-8000-000000000001';
select set_config(
  'test.entitlement_updated_at',
  (
    select updated_at::text
    from public.case_entitlements
    where id = 'f8000000-0000-4000-8000-000000000001'
  ),
  true
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);

select ok(
  (
    select customer_journey ->> 'nextState' = 'needs_attention'
      and customer_journey ->> 'fulfillmentState' = 'needs_attention'
      and published_report is null and message_draft is null
    from public.resolve_total_loss_case_claim(
      'f2000000-0000-4000-8000-000000000001'
    )
  ),
  'suspended entitlement forces both resolver states to needs-attention and removes report/message projections'
);

select is(
  (
    select owned_case.needs_attention
    from public.list_owned_case_operations() as owned_case
    where owned_case.case_id = 'f2000000-0000-4000-8000-000000000001'
  ),
  true,
  'the owner list exposes direct post-Continue entitlement attention without invoking the rich resolver'
);

select is(
  (
    select owned_case.last_activity_at::text
    from public.list_owned_case_operations() as owned_case
    where owned_case.case_id = 'f2000000-0000-4000-8000-000000000001'
  ),
  current_setting('test.entitlement_updated_at'),
  'the owner list includes entitlement changes in effective lifecycle activity'
);

select is(
  (select count(*) from public.get_total_loss_customer_reports(
    'f2000000-0000-4000-8000-000000000001', null
  )),
  0::bigint,
  'suspended entitlement denies the customer report RPC'
);

reset role;

update public.case_entitlements
set status = 'revoked', status_changed_at = statement_timestamp(),
    revoked_at = statement_timestamp(), reason_code = 'PAYMENT_REVERSED'
where id = 'f8000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);

select ok(
  (
    select customer_journey ->> 'nextState' = 'needs_attention'
      and customer_journey ->> 'fulfillmentState' = 'needs_attention'
      and published_report is null and message_draft is null
    from public.resolve_total_loss_case_claim(
      'f2000000-0000-4000-8000-000000000001'
    )
  ),
  'revoked entitlement forces both resolver states to needs-attention and removes report/message projections'
);

reset role;

update public.case_entitlements
set status = 'active', status_changed_at = statement_timestamp(),
    revoked_at = null, reason_code = null
where id = 'f8000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);

select ok(
  (
    select public.put_total_loss_sending_details(
      'f2000000-0000-4000-8000-000000000001',
      '  CLM   123  ', '  Alex   Adjuster  ', 'ADJUSTER@EXAMPLE.TEST',
      true, true, 0,
      (select workflow_revision from public.resolve_total_loss_case_claim(
        'f2000000-0000-4000-8000-000000000001'
      ))
    ) @> jsonb_build_object(
      'claimReference', 'CLM 123', 'adjusterName', 'Alex Adjuster',
      'adjusterEmail', 'adjuster@example.test',
      'claimReferenceConfirmed', true, 'adjusterEmailConfirmed', true
    )
  ),
  'sending-detail confirmation normalizes bounded customer input without rewriting source insurer facts'
);

select throws_ok(
  $$
    select public.prepare_total_loss_customer_message(
      'f2000000-0000-4000-8000-000000000001',
      'f1100000-0000-4000-8000-000000000001',
      (select workflow_revision from public.resolve_total_loss_case_claim(
        'f2000000-0000-4000-8000-000000000001'
      ))
    )
  $$,
  '55000',
  'The required result step must be completed first.',
  'message preparation is server-gated on required Screen 1 completion'
);

select ok(
  public.put_total_loss_education_progress(
    'f2000000-0000-4000-8000-000000000001', 'result', 'completed',
    (select workflow_revision from public.resolve_total_loss_case_claim(
      'f2000000-0000-4000-8000-000000000001'
    ))
  ) #>> '{steps,result,completedAt}' is not null,
  'required result progress persists against the exact current report'
);

select throws_ok(
  $$
    select public.prepare_total_loss_customer_message(
      'f2000000-0000-4000-8000-000000000001',
      'f1100000-0000-4000-8000-000000000001',
      (select workflow_revision from public.resolve_total_loss_case_claim(
        'f2000000-0000-4000-8000-000000000001'
      ))
    )
  $$,
  '55000',
  'Complete the guided review or explicitly skip to request preparation.',
  'direct prepare cannot bypass both completion and explicit optional-screen skip records'
);

select ok(
  public.put_total_loss_education_progress(
    'f2000000-0000-4000-8000-000000000001',
    'insurer_review', 'skipped',
    (select workflow_revision from public.resolve_total_loss_case_claim(
      'f2000000-0000-4000-8000-000000000001'
    ))
  ) #>> '{steps,insurer_review,skippedAt}' is not null,
  'an explicit optional-screen skip persists after required Screen 1 completion'
);

create temporary table m6_prepare_v1 on commit drop as
select public.prepare_total_loss_customer_message(
  'f2000000-0000-4000-8000-000000000001',
  'f1100000-0000-4000-8000-000000000001',
  (select workflow_revision from public.resolve_total_loss_case_claim(
    'f2000000-0000-4000-8000-000000000001'
  ))
) as response;

select ok(
  (
    select response #>> '{messageVersion,state}' = 'prepared'
      and response #>> '{draft,body}' like '%Example Insurance%'
      and response #>> '{draft,body}' like '%CLM 123%'
      and response #>> '{draft,body}' like '%Venfour_Valuation_Evidence_F20000000000_v1.pdf%'
    from m6_prepare_v1
  ),
  'deterministic preparation uses the confirmed claim, insurer, report, and filename facts'
);

select is(
  (
    select public.prepare_total_loss_customer_message(
      'f2000000-0000-4000-8000-000000000001',
      'f1100000-0000-4000-8000-000000000001',
      (select workflow_revision from public.resolve_total_loss_case_claim(
        'f2000000-0000-4000-8000-000000000001'
      ))
    ) #>> '{messageVersion,messageVersionId}'
  ),
  (select response #>> '{messageVersion,messageVersionId}' from m6_prepare_v1),
  'an exact prepare client-request replay returns the same immutable version'
);

select is(
  (
    (select count(*) from public.total_loss_message_drafts)
    + (select count(*) from public.total_loss_message_versions)
    + (select count(*) from public.total_loss_negotiation_rounds)
    + (select count(*) from public.total_loss_communications)
    + (select count(*) from public.total_loss_communication_documents)
  ),
  0::bigint,
  'even an active entitled owner cannot bypass bounded message RPCs with direct table reads'
);

reset role;

insert into public.total_loss_claim_documents (
  id, case_id, document_kind, storage_bucket_id, storage_object_name,
  original_filename, media_type, byte_size, content_digest, status, sealed_at
) values (
  'fd000000-0000-4000-8000-000000000002',
  'f2000000-0000-4000-8000-000000000001',
  'valuation_evidence_report', 'case-deliverables',
  'cases/f2000000-0000-4000-8000-000000000001/reports/fc000000-0000-4000-8000-000000000001/versions/fe000000-0000-4000-8000-000000000002/valuation-evidence-package.pdf',
  'valuation-evidence-package.pdf', 'application/pdf', 322, repeat('a', 64),
  'ready', statement_timestamp()
);

insert into storage.objects (id, bucket_id, name, metadata, user_metadata)
values (
  'ff000000-0000-4000-8000-000000000002', 'case-deliverables',
  'cases/f2000000-0000-4000-8000-000000000001/reports/fc000000-0000-4000-8000-000000000001/versions/fe000000-0000-4000-8000-000000000002/valuation-evidence-package.pdf',
  jsonb_build_object('mimetype', 'application/pdf', 'size', 322),
  jsonb_build_object('sha256', repeat('a', 64))
);

insert into public.total_loss_report_versions (
  id, case_id, report_series_id, version_number, final_assessment_id,
  preliminary_snapshot_id, document_id, renderer_version, template_version,
  schema_version, report, report_digest, status, published_at, package_job_id,
  supersedes_report_version_id
) select
  'fe000000-0000-4000-8000-000000000002',
  'f2000000-0000-4000-8000-000000000001',
  'fc000000-0000-4000-8000-000000000001', 2,
  'fb000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001',
  'fd000000-0000-4000-8000-000000000002', '1', '1', '1',
  (report - 'identity') || jsonb_build_object(
    'identity', (report -> 'identity') || jsonb_build_object(
      'reportVersionId', 'fe000000-0000-4000-8000-000000000002',
      'versionNumber', 2, 'versionLabel', 'v2',
      'suggestedFilename', 'Venfour_Valuation_Evidence_F20000000000_v2.pdf'
    )
  ),
  repeat('9', 64), 'published', statement_timestamp(),
  'f9000000-0000-4000-8000-000000000001',
  'fe000000-0000-4000-8000-000000000001'
from m6_report_payload;

update public.total_loss_report_series
set current_report_version_id = 'fe000000-0000-4000-8000-000000000002',
    current_published_report_version_id = 'fe000000-0000-4000-8000-000000000002'
where id = 'fc000000-0000-4000-8000-000000000001';

update public.total_loss_claim_workflows
set phase = 'review', current_task = 'report_ready',
    current_report_version_id = 'fe000000-0000-4000-8000-000000000002',
    revision = revision + 1
where case_id = 'f2000000-0000-4000-8000-000000000001';

set local role service_role;

select ok(
  (
    select
      (select count(*) from public.authorize_total_loss_customer_report_download(
        'f2000000-0000-4000-8000-000000000001',
        'fe000000-0000-4000-8000-000000000001',
        'f1000000-0000-4000-8000-000000000001'
      )) = 0
      and (
        select count(*) from public.authorize_total_loss_customer_report_download(
          'f2000000-0000-4000-8000-000000000001',
          'fe000000-0000-4000-8000-000000000002',
          'f1000000-0000-4000-8000-000000000001'
        )
      ) = 1
  ),
  'download authorization follows the exact current report and rejects a superseded publication'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);

select is(
  (select count(*) from public.get_total_loss_customer_reports(
    'f2000000-0000-4000-8000-000000000001',
    'fe000000-0000-4000-8000-000000000001'
  )),
  0::bigint,
  'the customer report RPC hides a superseded published version'
);

select throws_ok(
  $$
    select public.prepare_total_loss_customer_message(
      'f2000000-0000-4000-8000-000000000001',
      'f1100000-0000-4000-8000-000000000001',
      (select workflow_revision from public.resolve_total_loss_case_claim(
        'f2000000-0000-4000-8000-000000000001'
      ))
    )
  $$,
  '42501',
  'Prepared message is unavailable.',
  'an idempotency replay cannot revive a prepared version from a superseded report'
);

select throws_ok(
  $$
    select public.patch_total_loss_customer_message_draft(
      'f2000000-0000-4000-8000-000000000001',
      'adjuster@example.test', 'Stale edit', 'Stale edit',
      (select (response #>> '{draft,revision}')::bigint from m6_prepare_v1)
    )
  $$,
  '55000',
  'Prepare the message before editing it.',
  'a superseded report draft cannot be edited after the workflow current-report pointer changes'
);

select ok(
  (
    select customer_journey ->> 'nextState' = 'guide_result'
      and published_report ->> 'reportId' =
        'fe000000-0000-4000-8000-000000000002'
      and education_progress #>> '{steps,result,completedAt}' is null
    from public.resolve_total_loss_case_claim(
      'f2000000-0000-4000-8000-000000000001'
    )
  ),
  'a newly current report receives its own required guided-progress state'
);

select public.put_total_loss_education_progress(
  'f2000000-0000-4000-8000-000000000001', 'result', 'completed',
  (select workflow_revision from public.resolve_total_loss_case_claim(
    'f2000000-0000-4000-8000-000000000001'
  ))
);
select public.put_total_loss_education_progress(
  'f2000000-0000-4000-8000-000000000001', 'insurer_review', 'skipped',
  (select workflow_revision from public.resolve_total_loss_case_claim(
    'f2000000-0000-4000-8000-000000000001'
  ))
);

create temporary table m6_prepare_v2 on commit drop as
select public.prepare_total_loss_customer_message(
  'f2000000-0000-4000-8000-000000000001',
  'f1200000-0000-4000-8000-000000000001',
  (select workflow_revision from public.resolve_total_loss_case_claim(
    'f2000000-0000-4000-8000-000000000001'
  ))
) as response;

select ok(
  (
    select current.response #>> '{draft,draftId}' <>
        prior.response #>> '{draft,draftId}'
      and current.response #>> '{draft,reportVersionId}' =
        'fe000000-0000-4000-8000-000000000002'
      and current.response #>> '{draft,body}' like '%_v2.pdf%'
    from m6_prepare_v2 as current
    cross join m6_prepare_v1 as prior
  ),
  'the report-aware draft identity creates a fresh deterministic draft for a newly current report'
);

create temporary table m6_patch_v2 on commit drop as
select public.patch_total_loss_customer_message_draft(
  'f2000000-0000-4000-8000-000000000001',
  'new.adjuster@example.test', 'Edited reconsideration request',
  'Please review the edited request and attached evidence package.',
  (select (response #>> '{draft,revision}')::bigint from m6_prepare_v2)
) as response;

select ok(
  (
    select response ->> 'recipient' = 'new.adjuster@example.test'
      and response ->> 'subject' = 'Edited reconsideration request'
      and (response ->> 'revision')::bigint = 2
    from m6_patch_v2
  ),
  'optimistic draft editing persists only customer-editable fields and increments its revision'
);

create temporary table m6_prepare_v2_edited on commit drop as
select public.prepare_total_loss_customer_message(
  'f2000000-0000-4000-8000-000000000001',
  'f1200000-0000-4000-8000-000000000002',
  (select workflow_revision from public.resolve_total_loss_case_claim(
    'f2000000-0000-4000-8000-000000000001'
  ))
) as response;

select ok(
  (
    select response #>> '{messageVersion,state}' = 'prepared'
      and response #>> '{messageVersion,recipient}' = 'new.adjuster@example.test'
      and response #>> '{messageVersion,subject}' = 'Edited reconsideration request'
    from m6_prepare_v2_edited
  ),
  'preparing after an edit snapshots the exact current draft into a new immutable version'
);

create temporary table m6_email_open on commit drop as
select public.record_total_loss_customer_email_opened(
  'f2000000-0000-4000-8000-000000000001',
  (select (response #>> '{messageVersion,messageVersionId}')::uuid
   from m6_prepare_v2_edited),
  'f1300000-0000-4000-8000-000000000001'
) as response;

select ok(
  (
    select response ->> 'status' = 'opened'
      and response -> 'authoritativeSent' = 'false'::jsonb
      and (
        select workflow_current_task
        from public.resolve_total_loss_case_claim(
          'f2000000-0000-4000-8000-000000000001'
        )
      ) = 'prepare_request'
    from m6_email_open
  ),
  'opening an email app records a non-authoritative event without advancing the workflow'
);

create temporary table m6_sent on commit drop as
select public.confirm_total_loss_customer_message_sent(
  'f2000000-0000-4000-8000-000000000001',
  (select (response #>> '{messageVersion,messageVersionId}')::uuid
   from m6_prepare_v2_edited),
  'f1400000-0000-4000-8000-000000000001',
  (select workflow_revision from public.resolve_total_loss_case_claim(
    'f2000000-0000-4000-8000-000000000001'
  )),
  true
) as response;

select ok(
  (
    select response ->> 'state' = 'awaiting_insurer_response'
      and response ->> 'communicationId' is not null
      and response ->> 'negotiationRoundId' is not null
      and response ->> 'customerReportedSentAt' is not null
    from m6_sent
  ),
  'explicit attached-report confirmation advances atomically to waiting for insurer'
);

reset role;

select ok(
  (
    select
      (select count(*) from public.total_loss_message_drafts
       where case_id = 'f2000000-0000-4000-8000-000000000001') = 2
      and (select generated_recipient = 'adjuster@example.test'
             and recipient = 'new.adjuster@example.test'
           from public.total_loss_message_drafts
           where report_version_id = 'fe000000-0000-4000-8000-000000000002')
      and (select count(*) from public.total_loss_negotiation_rounds
           where case_id = 'f2000000-0000-4000-8000-000000000001'
             and round_number = 1 and status = 'waiting_for_insurer') = 1
      and (select count(*) from public.total_loss_communications
           where case_id = 'f2000000-0000-4000-8000-000000000001'
             and status = 'confirmed'
             and communication_type = 'initial_reconsideration_request') = 1
      and (select count(*)
           from public.total_loss_communication_documents as link
           where link.case_id = 'f2000000-0000-4000-8000-000000000001'
             and link.document_id = 'fd000000-0000-4000-8000-000000000002') = 1
      and (select count(*) from public.total_loss_message_versions
           where case_id = 'f2000000-0000-4000-8000-000000000001'
             and message_state = 'customer_reported_sent'
             and report_version_id = 'fe000000-0000-4000-8000-000000000002') = 1
      and (select current_task = 'awaiting_insurer_response'
             and phase = 'negotiation'
           from public.total_loss_claim_workflows
           where case_id = 'f2000000-0000-4000-8000-000000000001')
  ),
  'sent confirmation preserves generated baseline, attaches the exact report, and creates one immutable snapshot, communication, and Round 1'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);

select is(
  public.confirm_total_loss_customer_message_sent(
    'f2000000-0000-4000-8000-000000000001',
    (select (response #>> '{messageVersion,messageVersionId}')::uuid
     from m6_prepare_v2_edited),
    'f1400000-0000-4000-8000-000000000001',
    (select workflow_revision from public.resolve_total_loss_case_claim(
      'f2000000-0000-4000-8000-000000000001'
    )),
    true
  ) - 'customerReportedSentAt',
  (select response - 'customerReportedSentAt' from m6_sent),
  'an exact sent-confirmation replay returns the same identities without duplicate authority'
);

select throws_ok(
  $$
    select public.prepare_total_loss_customer_message(
      'f2000000-0000-4000-8000-000000000001',
      'f1500000-0000-4000-8000-000000000001',
      (select workflow_revision from public.resolve_total_loss_case_claim(
        'f2000000-0000-4000-8000-000000000001'
      ))
    )
  $$,
  '55000',
  'Message preparation is unavailable in the current workflow state.',
  'a fresh post-send prepare request cannot roll the waiting workflow backward'
);

select is(
  (
    select public.prepare_total_loss_customer_message(
      'f2000000-0000-4000-8000-000000000001',
      'f1200000-0000-4000-8000-000000000002',
      (select workflow_revision from public.resolve_total_loss_case_claim(
        'f2000000-0000-4000-8000-000000000001'
      ))
    ) #>> '{messageVersion,messageVersionId}'
  ),
  (select response #>> '{messageVersion,messageVersionId}'
   from m6_prepare_v2_edited),
  'the exact current-report prepare replay remains read-only after send'
);

reset role;

update public.case_entitlements
set status = 'suspended', status_changed_at = statement_timestamp()
where id = 'f8000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);

select ok(
  (
    select customer_journey ->> 'nextState' = 'needs_attention'
      and customer_journey ->> 'fulfillmentState' = 'needs_attention'
      and published_report is null and message_draft is null
      and (select public.get_total_loss_customer_message_draft(
        'f2000000-0000-4000-8000-000000000001'
      )) is null
      and (select count(*) from public.total_loss_message_versions) = 0
    from public.resolve_total_loss_case_claim(
      'f2000000-0000-4000-8000-000000000001'
    )
  ),
  'post-send suspended entitlement removes all report/message projections and direct reads'
);

reset role;

update public.case_entitlements
set status = 'revoked', status_changed_at = statement_timestamp(),
    revoked_at = statement_timestamp(), reason_code = 'PAYMENT_REVERSED'
where id = 'f8000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);

select ok(
  (
    select customer_journey ->> 'nextState' = 'needs_attention'
      and customer_journey ->> 'fulfillmentState' = 'needs_attention'
      and published_report is null and message_draft is null
      and (select count(*) from public.get_total_loss_customer_reports(
        'f2000000-0000-4000-8000-000000000001', null
      )) = 0
      and (select count(*) from public.total_loss_message_drafts) = 0
    from public.resolve_total_loss_case_claim(
      'f2000000-0000-4000-8000-000000000001'
    )
  ),
  'post-send revoked entitlement denies the resolver, report RPC, draft RPC, and direct message reads'
);

select * from finish();
rollback;
