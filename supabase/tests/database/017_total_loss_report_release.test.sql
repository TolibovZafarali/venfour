begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(56);

select ok(
  to_regclass('public.total_loss_report_versions') is not null
    and exists (
      select 1 from storage.buckets
      where id = 'case-deliverables' and not public
    ),
  'M5 reuses report versions and provisions one private deliverables bucket'
);

select is(
  public.total_loss_canonical_jsonb_digest(
    '{"z":"é","a":[{"status":"PASS","code":"X"},2,true,null]}'::jsonb
  ),
  '885519ed2629dd86f3342c617ace1244fad4b07c896cd0501171588a449c6ff2',
  'database canonical JSON digest matches the backend UTF-8 sorted compact contract'
);

select ok(
  to_regprocedure('public.resolve_workflow_work_item_kind(uuid)') is not null
    and to_regprocedure('public.total_loss_canonical_jsonb_text(jsonb)') is not null
    and to_regprocedure('public.total_loss_canonical_jsonb_digest(jsonb)') is not null
    and to_regprocedure('public.claim_total_loss_report_generation_work_item(uuid,uuid)') is not null
    and to_regprocedure('public.complete_total_loss_report_generation(uuid,uuid,jsonb,text,text,text,text,text,jsonb,bigint,text)') is not null
    and to_regprocedure('public.claim_total_loss_report_review_work_item(uuid,uuid)') is not null
    and to_regprocedure('public.begin_total_loss_ai_review(uuid,uuid,text,text,text,text,text)') is not null
    and to_regprocedure('public.resolve_total_loss_report_release_context(uuid,uuid,uuid)') is not null
    and to_regprocedure('public.complete_total_loss_ai_review(uuid,uuid,uuid,text,text,text,text,jsonb,text,jsonb,text,jsonb,text)') is not null
    and to_regprocedure('public.resolve_total_loss_report_release(uuid,uuid,uuid)') is not null
    and to_regprocedure('public.resolve_total_loss_no_dispute_refund_recovery(uuid)') is not null
    and to_regprocedure('public.hold_total_loss_no_dispute_refund_failure(uuid,uuid)') is not null
    and to_regprocedure('public.complete_total_loss_no_dispute_refund(uuid,uuid)') is not null
    and to_regprocedure('public.fail_total_loss_report_work_item(uuid,uuid,text,text,integer)') is not null,
  'the complete report generation, review, release, refund recovery, and failure RPC surface exists'
);

select ok(
  (
    select count(*) = 15
      and bool_and(procedure.prosecdef)
      and bool_and('search_path=""' = any(procedure.proconfig))
    from pg_proc as procedure
    where procedure.oid = any(array[
      'public.enqueue_total_loss_report_generation(uuid)'::regprocedure,
      'public.resolve_workflow_work_item_kind(uuid)'::regprocedure,
      'public.claim_total_loss_report_generation_work_item(uuid,uuid)'::regprocedure,
      'public.resolve_total_loss_report_generation_context(uuid,uuid)'::regprocedure,
      'public.complete_total_loss_report_generation(uuid,uuid,jsonb,text,text,text,text,text,jsonb,bigint,text)'::regprocedure,
      'public.claim_total_loss_report_review_work_item(uuid,uuid)'::regprocedure,
      'public.resolve_total_loss_report_review_context(uuid,uuid)'::regprocedure,
      'public.resolve_total_loss_report_release_context(uuid,uuid,uuid)'::regprocedure,
      'public.begin_total_loss_ai_review(uuid,uuid,text,text,text,text,text)'::regprocedure,
      'public.complete_total_loss_ai_review(uuid,uuid,uuid,text,text,text,text,jsonb,text,jsonb,text,jsonb,text)'::regprocedure,
      'public.resolve_total_loss_report_release(uuid,uuid,uuid)'::regprocedure,
      'public.resolve_total_loss_no_dispute_refund_recovery(uuid)'::regprocedure,
      'public.hold_total_loss_no_dispute_refund_failure(uuid,uuid)'::regprocedure,
      'public.complete_total_loss_no_dispute_refund(uuid,uuid)'::regprocedure,
      'public.fail_total_loss_report_work_item(uuid,uuid,text,text,integer)'::regprocedure
    ])
  ),
  'all internal report lifecycle RPCs are pinned SECURITY DEFINER functions'
);

select ok(
  has_function_privilege('service_role', 'public.resolve_total_loss_report_release(uuid,uuid,uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.total_loss_canonical_jsonb_digest(jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.total_loss_canonical_jsonb_digest(jsonb)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.total_loss_canonical_jsonb_text(jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.fail_total_loss_report_work_item(uuid,uuid,text,text,integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.hold_total_loss_no_dispute_refund_failure(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.hold_total_loss_no_dispute_refund_failure(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.resolve_total_loss_report_release(uuid,uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.complete_total_loss_report_generation(uuid,uuid,jsonb,text,text,text,text,text,jsonb,bigint,text)', 'EXECUTE')
    and not has_function_privilege('public', 'public.resolve_total_loss_no_dispute_refund_recovery(uuid)', 'EXECUTE'),
  'internal report lifecycle execution is service-only'
);

select ok(
  has_function_privilege('authenticated', 'public.get_total_loss_release_review(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.decide_total_loss_release_review(uuid,timestamptz,text,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_total_loss_release_review(uuid)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.decide_total_loss_release_review(uuid,timestamptz,text,text)', 'EXECUTE'),
  'only authenticated staff JWTs receive the staff decision RPC grants'
);

select ok(
  not has_table_privilege('anon', 'public.total_loss_report_versions', 'SELECT')
    and not has_table_privilege('authenticated', 'public.total_loss_report_versions', 'INSERT,UPDATE,DELETE')
    and not exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and cmd <> 'SELECT'
        and (qual like '%case-deliverables%' or with_check like '%case-deliverables%')
    ),
  'browser roles cannot mutate reports or private deliverable objects'
);

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values ('a1000000-0000-4000-8000-000000000001', 'm5@example.test', statement_timestamp(), false);

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values ('a1000000-0000-4000-8000-000000000002', 'm5-staff@example.test', statement_timestamp(), false);

insert into public.staff_members (user_id)
values ('a1000000-0000-4000-8000-000000000002');

create function pg_temp.create_m5_case(
  requested_case_id uuid,
  requested_input_id uuid,
  requested_analysis_job_id uuid,
  requested_analysis_run_id uuid,
  requested_preliminary_snapshot_id uuid,
  requested_order_id uuid,
  requested_entitlement_id uuid,
  requested_package_job_id uuid,
  requested_source_snapshot_id uuid,
  requested_final_assessment_id uuid,
  requested_payment_transaction_id uuid,
  requested_continuation_status text
)
returns void
language plpgsql
as $$
begin
  insert into public.appraisal_cases (id, user_id, service_type, status)
  values (requested_case_id, 'a1000000-0000-4000-8000-000000000001', 'total_loss', 'check_complete');

  insert into public.total_loss_case_details (
    case_id, intake_mode, vin, vehicle_year, vehicle_make, vehicle_model,
    vehicle_trim, mileage_at_loss, postal_code, date_of_loss, insurer_name,
    insurer_vehicle_valuation, intake_completed_at, analysis_input_revision,
    analysis_input_id
  ) values (
    requested_case_id, 'manual', '1HGCM82633A004352', 2022, 'Honda',
    'Accord', 'EX-L', 32000, '60601', '2026-08-20', 'Example Insurance',
    18000, statement_timestamp(), 1, requested_input_id
  );

  insert into public.total_loss_case_contacts (
    case_id, full_name, email, service_terms_version,
    service_terms_acknowledged_at, privacy_notice_version,
    privacy_notice_acknowledged_at, operational_follow_up_allowed,
    operational_follow_up_updated_at
  ) values (
    requested_case_id, 'M5 Customer', 'm5@example.test', '2026-08-23',
    statement_timestamp(), '2026-08-23', statement_timestamp(), false,
    statement_timestamp()
  );

  insert into public.total_loss_analysis_jobs (
    id, case_id, source_details_updated_at, status, attempt_count,
    processing_token, run_id, finished_at, source_intake_mode,
    source_analysis_input_revision, source_analysis_input_id
  ) values (
    requested_analysis_job_id, requested_case_id, statement_timestamp(),
    'completed', 1, gen_random_uuid(), requested_analysis_run_id,
    statement_timestamp(), 'manual', 1, requested_input_id
  );

  insert into public.analysis_runs (
    id, job_id, case_id, artifact, request_digest,
    analysis_run_schema_version, analysis_version,
    discrepancy_analysis_version, comparable_scoring_version
  ) values (
    requested_analysis_run_id, requested_analysis_job_id, requested_case_id,
    jsonb_build_object('runId', requested_analysis_run_id::text), repeat('1', 64),
    '4', '4', '1', '1'
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
    requested_preliminary_snapshot_id, requested_case_id,
    requested_analysis_job_id, requested_analysis_run_id,
    'a1000000-0000-4000-8000-000000000001', 'manual', 1,
    requested_input_id, 'MATERIAL_UNDERVALUE_SIGNAL', 1800000, 2000000,
    2100000, 2200000, 'USD', '4', '4', '1', '1', '1', '1',
    jsonb_build_object('analysisRunId', requested_analysis_run_id::text),
    jsonb_build_object('classification', 'MATERIAL_UNDERVALUE_SIGNAL'),
    repeat('2', 64)
  );

  insert into public.total_loss_claim_workflows (
    case_id, preliminary_snapshot_id, phase, current_task
  ) values (requested_case_id, requested_preliminary_snapshot_id, 'review', 'awaiting_report_generation');

  insert into public.commerce_orders (
    id, case_id, purchaser_user_id, preliminary_snapshot_id,
    product_identifier, product_version, amount_minor_units, currency,
    payment_provider, external_price_identifier, provider_livemode,
    purchaser_email, status, terms_version, refund_policy_version, paid_at
  ) values (
    requested_order_id, requested_case_id,
    'a1000000-0000-4000-8000-000000000001', requested_preliminary_snapshot_id,
    'total-loss-package', '1', 9900, 'USD', 'stripe',
    'price_test_total_loss_v1', false, 'm5@example.test', 'paid',
    'terms-1', 'refund-1', statement_timestamp()
  );

  insert into public.payment_transactions (
    id, case_id, order_id, payment_provider, transaction_kind,
    external_object_id, amount_minor_units, currency, provider_occurred_at
  ) values (
    requested_payment_transaction_id, requested_case_id, requested_order_id,
    'stripe', 'payment', 'pi_' || replace(requested_case_id::text, '-', ''),
    9900, 'USD', statement_timestamp() - interval '1 minute'
  );

  insert into public.case_entitlements (
    id, case_id, order_id, preliminary_snapshot_id, product_identifier,
    product_version, status
  ) values (
    requested_entitlement_id, requested_case_id, requested_order_id,
    requested_preliminary_snapshot_id, 'total-loss-package', '1', 'active'
  );

  insert into public.total_loss_package_jobs (
    id, case_id, entitlement_id, preliminary_snapshot_id, status,
    attempt_count, processing_token, started_at, finished_at
  ) values (
    requested_package_job_id, requested_case_id, requested_entitlement_id,
    requested_preliminary_snapshot_id, 'assessment_ready', 1,
    gen_random_uuid(), statement_timestamp(), statement_timestamp()
  );

  update public.total_loss_claim_workflows
  set current_package_job_id = requested_package_job_id,
      revision = revision + 1
  where case_id = requested_case_id;

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
    requested_source_snapshot_id, requested_case_id, requested_package_job_id,
    requested_entitlement_id, requested_preliminary_snapshot_id,
    requested_analysis_job_id, requested_analysis_run_id,
    'a1000000-0000-4000-8000-000000000001', 'manual', 1,
    requested_input_id, false, repeat('3', 64), repeat('2', 64),
    repeat('1', 64), '2026-08-20', '2026-08-26T12:00:00Z',
    '4', '4', '1', '1', '1', '1', '1',
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
    requested_final_assessment_id, requested_case_id, requested_package_job_id,
    requested_preliminary_snapshot_id, requested_source_snapshot_id, 1,
    'MATERIAL_UNDERVALUE_SIGNAL', 'USD', 2000000, 2100000, 2200000,
    jsonb_build_array(), jsonb_build_array(), jsonb_build_array(),
    jsonb_build_object('materialChange', false),
    jsonb_build_object(
      'schemaVersion', '1', 'continuationStatus', requested_continuation_status,
      'assessmentDigest', repeat('6', 64)
    ), '1', '1', repeat('6', 64)
  );
end;
$$;

select pg_temp.create_m5_case(
  'a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001',
  'a7000000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000001',
  'a9000000-0000-4000-8000-000000000001',
  'aa000000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001',
  'DOES_NOT_SUPPORT_CONTINUATION'
);

select pg_temp.create_m5_case(
  'a2000000-0000-4000-8000-000000000002',
  'a3000000-0000-4000-8000-000000000002',
  'a4000000-0000-4000-8000-000000000002',
  'a5000000-0000-4000-8000-000000000002',
  'a6000000-0000-4000-8000-000000000002',
  'a7000000-0000-4000-8000-000000000002',
  'a8000000-0000-4000-8000-000000000002',
  'a9000000-0000-4000-8000-000000000002',
  'aa000000-0000-4000-8000-000000000002',
  'ab000000-0000-4000-8000-000000000002',
  'ac000000-0000-4000-8000-000000000002',
  'SUPPORTS_CONTINUATION'
);

select pg_temp.create_m5_case(
  'a2000000-0000-4000-8000-000000000003',
  'a3000000-0000-4000-8000-000000000003',
  'a4000000-0000-4000-8000-000000000003',
  'a5000000-0000-4000-8000-000000000003',
  'a6000000-0000-4000-8000-000000000003',
  'a7000000-0000-4000-8000-000000000003',
  'a8000000-0000-4000-8000-000000000003',
  'a9000000-0000-4000-8000-000000000003',
  'aa000000-0000-4000-8000-000000000003',
  'ab000000-0000-4000-8000-000000000003',
  'ac000000-0000-4000-8000-000000000003',
  'SUPPORTS_CONTINUATION'
);

select pg_temp.create_m5_case(
  'a2000000-0000-4000-8000-000000000004',
  'a3000000-0000-4000-8000-000000000004',
  'a4000000-0000-4000-8000-000000000004',
  'a5000000-0000-4000-8000-000000000004',
  'a6000000-0000-4000-8000-000000000004',
  'a7000000-0000-4000-8000-000000000004',
  'a8000000-0000-4000-8000-000000000004',
  'a9000000-0000-4000-8000-000000000004',
  'aa000000-0000-4000-8000-000000000004',
  'ab000000-0000-4000-8000-000000000004',
  'ac000000-0000-4000-8000-000000000004',
  'SUPPORTS_CONTINUATION'
);

select pg_temp.create_m5_case(
  'a2000000-0000-4000-8000-000000000005',
  'a3000000-0000-4000-8000-000000000005',
  'a4000000-0000-4000-8000-000000000005',
  'a5000000-0000-4000-8000-000000000005',
  'a6000000-0000-4000-8000-000000000005',
  'a7000000-0000-4000-8000-000000000005',
  'a8000000-0000-4000-8000-000000000005',
  'a9000000-0000-4000-8000-000000000005',
  'aa000000-0000-4000-8000-000000000005',
  'ab000000-0000-4000-8000-000000000005',
  'ac000000-0000-4000-8000-000000000005',
  'DOES_NOT_SUPPORT_CONTINUATION'
);

set local role service_role;

create temporary table m5_enqueue on commit drop as
select * from public.enqueue_total_loss_report_generation(
  'a9000000-0000-4000-8000-000000000001'
);

select ok(
  (select outcome = 'created' and work_type = 'total_loss_report_generate'
     and work_version = '1' from m5_enqueue),
  'assessment-ready package enqueues report generation version 1'
);

create temporary table m5_generation_claim on commit drop as
select * from public.claim_total_loss_report_generation_work_item(
  (select work_item_id from m5_enqueue),
  'ad000000-0000-4000-8000-000000000001'
);

select ok(
  (select outcome = 'claimed' and report_version_id is not null
     and document_id is not null and storage_bucket_id = 'case-deliverables'
     and original_filename = 'valuation-evidence-package.pdf'
     and storage_object_name =
       'cases/' || case_id::text || '/reports/' || report_series_id::text ||
       '/versions/' || report_version_id::text ||
       '/valuation-evidence-package.pdf'
     and generated_at is not null from m5_generation_claim),
  'generation claim reserves the exact canonical bucket, internal filename, path, and identities'
);

select ok(
  (
    select first_claim.report_version_id = replay.report_version_id
      and first_claim.document_id = replay.document_id
      and first_claim.storage_object_name = replay.storage_object_name
      and first_claim.generated_at = replay.generated_at
      and replay.attempt_count = 1
    from m5_generation_claim as first_claim
    cross join public.claim_total_loss_report_generation_work_item(
      first_claim.work_item_id,
      'ad000000-0000-4000-8000-000000000001'
    ) as replay
  ),
  'same-token generation replay preserves every stable reserved identity'
);

reset role;

insert into storage.objects (
  id, bucket_id, name, metadata, user_metadata
)
select
  'ae000000-0000-4000-8000-000000000001', storage_bucket_id,
  storage_object_name,
  jsonb_build_object('mimetype', 'application/pdf', 'size', 321),
  jsonb_build_object('sha256', repeat('8', 64))
from m5_generation_claim;

set local role service_role;

create temporary table m5_pdf_validation_manifest on commit drop as
with unsigned_manifest as (
  select jsonb_build_object(
    'schemaVersion', '1', 'status', 'PASS',
    'reportVersionId', claim.report_version_id::text,
    'reportDigest', repeat('7', 64), 'rendererVersion', '1',
    'templateVersion', '1', 'filename', claim.original_filename,
    'mediaType', 'application/pdf', 'pdfSha256', repeat('8', 64),
    'byteSize', 321
  ) as manifest
  from m5_generation_claim as claim
), signed_manifest as (
  select
    manifest || jsonb_build_object(
      'manifestDigest', public.total_loss_canonical_jsonb_digest(manifest)
    ) as manifest,
    public.total_loss_canonical_jsonb_digest(manifest) as inner_manifest_digest
  from unsigned_manifest
)
select
  manifest as validation_manifest,
  inner_manifest_digest,
  public.total_loss_canonical_jsonb_digest(manifest) as full_manifest_digest
from signed_manifest;

create temporary table m5_generated on commit drop as
select completion.*
from m5_generation_claim as claim
cross join lateral public.complete_total_loss_report_generation(
  claim.work_item_id,
  'ad000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'schemaVersion', '1',
    'identity', jsonb_build_object(
      'caseId', claim.case_id::text,
      'reportSeriesId', claim.report_series_id::text,
      'reportVersionId', claim.report_version_id::text,
      'finalAssessmentId', 'ab000000-0000-4000-8000-000000000001',
      'versionNumber', claim.report_version_number,
      'generatedAt', to_char(claim.generated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'suggestedFilename', 'Venfour_Valuation_Evidence_A20000000000_v1.pdf'
    ),
    'lineage', jsonb_build_object(
      'sourceSnapshotId', 'aa000000-0000-4000-8000-000000000001',
      'finalAssessmentId', 'ab000000-0000-4000-8000-000000000001',
      'sourceSnapshotDigest', repeat('4', 64),
      'finalAssessmentDigest', repeat('6', 64)
    ),
    'reportDigest', repeat('7', 64)
  ),
  repeat('7', 64), '1', '1', '1', '1',
  (select validation_manifest from m5_pdf_validation_manifest),
  321, repeat('8', 64)
) as completion;

select ok(
  (select generated.outcome = 'completed'
     and generated.report_status = 'validated'
     and generated.package_status = 'waiting_ai_review'
     and generated.review_work_item_id is not null
     and exists (
       select 1
       from public.total_loss_report_versions as report_version
       join public.total_loss_claim_documents as document
         on document.id = report_version.document_id
       where report_version.id = claim.report_version_id
         and report_version.report -> 'identity' ->> 'suggestedFilename' =
           'Venfour_Valuation_Evidence_A20000000000_v1.pdf'
         and report_version.report -> 'identity' ->> 'suggestedFilename'
           <> document.original_filename
         and document.original_filename = 'valuation-evidence-package.pdf'
         and report_version.validation_manifest ->> 'filename' =
           document.original_filename
     )
   from m5_generated as generated
   cross join m5_generation_claim as claim),
  'generation completion keeps the friendly filename separate while sealing the canonical PDF and enqueuing review'
);

select ok(
  (
    select inner_manifest_digest = validation_manifest ->> 'manifestDigest'
      and full_manifest_digest =
        public.total_loss_canonical_jsonb_digest(validation_manifest)
      and full_manifest_digest <> inner_manifest_digest
    from m5_pdf_validation_manifest
  ),
  'the full PDF validation-manifest digest is explicitly distinct from its unsigned self-digest'
);

select ok(
  (select status = 'ready' and content_digest = repeat('8', 64)
     and byte_size = 321 and sealed_at is not null
   from public.total_loss_claim_documents
   where id = (select document_id from m5_generation_claim)),
  'the document metadata is sealed only after exact Storage metadata validation'
);

grant select on m5_generation_claim to authenticated;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*) from public.total_loss_report_versions
   where id = (select report_version_id from m5_generation_claim)),
  0::bigint,
  'owners cannot read validated or reviewing report drafts'
);
select is(
  (select count(*) from public.total_loss_claim_documents
   where id = (select document_id from m5_generation_claim)),
  0::bigint,
  'owners cannot read ready document metadata before report publication'
);
select is(
  (select count(*) from storage.objects
   where bucket_id = 'case-deliverables'
     and name = (select storage_object_name from m5_generation_claim)),
  0::bigint,
  'owners cannot read the private deliverable object before publication'
);

reset role;
set local role service_role;

create temporary table m5_review_claim on commit drop as
select * from public.claim_total_loss_report_review_work_item(
  (select review_work_item_id from m5_generated),
  'af000000-0000-4000-8000-000000000001'
);

select ok(
  (select outcome = 'claimed' and report_digest = repeat('7', 64)
     and pdf_digest = repeat('8', 64) from m5_review_claim),
  'review claim establishes the second package/work dual fence'
);

create temporary table m5_ai_begin on commit drop as
select * from public.begin_total_loss_ai_review(
  (select work_item_id from m5_review_claim),
  'af000000-0000-4000-8000-000000000001',
  'openai', 'gpt-test-approved', '1', '1', repeat('9', 64)
);

select ok(
  (select outcome = 'created' and review_status = 'processing'
     and attempt_number = 1 from m5_ai_begin),
  'AI review begins with one immutable configured-model attempt'
);

select ok(
  (
    select report_status = 'reviewing'
      and source_validation_passed
      and report_json_schema_passed
      and deterministic_report_validation_passed
      and pdf_validation_passed
      and pdf_validation_digest = (
        select full_manifest_digest from m5_pdf_validation_manifest
      )
      and package_is_current and report_is_current and review_is_current
      and not human_decision_recorded
    from public.resolve_total_loss_report_release_context(
      (select work_item_id from m5_review_claim),
      'af000000-0000-4000-8000-000000000001',
      (select ai_review_run_id from m5_ai_begin)
    )
  ),
  'pre-completion release context reloads current authoritative validation and lineage state'
);

create temporary table m5_ai_complete on commit drop as
select completed.*
from m5_ai_begin as begun
cross join m5_review_claim as claim
cross join lateral public.complete_total_loss_ai_review(
  claim.work_item_id,
  'af000000-0000-4000-8000-000000000001',
  begun.ai_review_run_id, 'completed', 'gpt-test-approved', 'PASS', 'HIGH',
  jsonb_build_object(
    'schemaVersion', '1',
    'reviewedTarget', jsonb_build_object(
      'caseId', claim.case_id::text,
      'sourceSnapshotId', claim.source_snapshot_id::text,
      'finalAssessmentId', claim.final_assessment_id::text,
      'reportVersionId', claim.report_version_id::text
    ),
    'reviewedDigests', jsonb_build_object(
      'inputDigest', repeat('9', 64),
      'sourceSnapshotDigest', repeat('4', 64),
      'finalAssessmentDigest', repeat('6', 64),
      'reportDigest', repeat('7', 64),
      'pdfDigest', repeat('8', 64),
      'deterministicValidationDigest', repeat('d', 64),
      'pdfValidationDigest', (
        select full_manifest_digest from m5_pdf_validation_manifest
      )
    ),
    'recommendation', 'PASS', 'confidence', 'HIGH',
    'mandatoryChecks', jsonb_build_array(
      jsonb_build_object('checkId','LINEAGE','status','PASS'),
      jsonb_build_object('checkId','SUBJECT_VEHICLE','status','PASS'),
      jsonb_build_object('checkId','INSURER_VALUATION','status','PASS'),
      jsonb_build_object('checkId','INSURER_COMPARABLES','status','PASS'),
      jsonb_build_object('checkId','EXTERNAL_COMPARABLES','status','PASS'),
      jsonb_build_object('checkId','CALCULATIONS','status','PASS'),
      jsonb_build_object('checkId','METHODOLOGY_BOUNDARIES','status','PASS'),
      jsonb_build_object('checkId','EVIDENCE_ATTRIBUTION','status','PASS'),
      jsonb_build_object('checkId','LIMITATIONS','status','PASS'),
      jsonb_build_object('checkId','PDF_CONSISTENCY','status','PASS'),
      jsonb_build_object('checkId','OVERALL_CONCLUSION','status','PASS')
    ),
    'findings', jsonb_build_array(),
    'unsupportedConclusions', jsonb_build_array(),
    'conflicts', jsonb_build_array(),
    'missingEvidence', jsonb_build_array(),
    'sourceReferenceValidation', jsonb_build_object(
      'status','PASS','unknownIds',jsonb_build_array()
    ),
    'untrustedInstructionDetected', false,
    'untrustedInstructionFollowed', false
  ),
  repeat('f', 64), jsonb_build_object('inputTokens', 100), null,
  jsonb_build_object(
    'schemaVersion', '1',
    'disposition', 'AUTO_RELEASE_NO_DISPUTE_REFUND',
    'caseId', claim.case_id::text,
    'packageJobId', claim.package_job_id::text,
    'workItemId', claim.work_item_id::text,
    'reportVersionId', claim.report_version_id::text,
    'sourceSnapshotId', claim.source_snapshot_id::text,
    'finalAssessmentId', claim.final_assessment_id::text,
    'aiReviewRunId', begun.ai_review_run_id::text,
    'sourceSnapshotDigest', repeat('4', 64),
    'finalAssessmentDigest', repeat('6', 64),
    'reportDigest', repeat('7', 64), 'pdfDigest', repeat('8', 64),
    'inputDigest', repeat('9', 64), 'outputDigest', repeat('f', 64),
    'deterministicValidationDigest', repeat('d', 64),
    'pdfValidationDigest', (
      select full_manifest_digest from m5_pdf_validation_manifest
    ),
    'configuredModelIdentifier', 'gpt-test-approved',
    'returnedModelIdentifier', 'gpt-test-approved',
    'promptVersion', '1', 'reviewSchemaVersion', '1',
    'releaseGateEnabled', true, 'approvalConfigurationComplete', true,
    'approvedModelIdentifier', 'gpt-test-approved',
    'approvedPromptVersion', '1', 'approvedSchemaVersion', '1',
    'approvedEvalSuiteDigest', repeat('a', 64),
    'providerEvaluationPassed', true,
    'providerEvaluationModelIdentifier', 'gpt-test-approved',
    'providerEvaluationPromptVersion', '1',
    'providerEvaluationSchemaVersion', '1',
    'providerEvaluationSuiteDigest', repeat('a', 64),
    'sourceValidationPassed', true, 'reportJsonSchemaPassed', true,
    'deterministicReportValidationPassed', true,
    'pdfValidationPassed', true, 'aiSchemaValidationPassed', true,
    'packageIsCurrent', true, 'reportIsCurrent', true,
    'reviewIsCurrent', true, 'humanDecisionRecorded', false,
    'reasonCodes', jsonb_build_array('ALL_NO_DISPUTE_RELEASE_CHECKS_PASSED')
  ),
  repeat('b', 64)
) as completed;

select ok(
  (select outcome = 'completed' and review_status = 'completed'
     and recommendation = 'PASS' and confidence = 'HIGH'
   from m5_ai_complete),
  'AI completion persists immutable provider terminal facts without publishing'
);

select is(
  (select status from public.total_loss_report_versions
   where id = (select report_version_id from m5_review_claim)),
  'reviewing'::text,
  'AI terminal completion alone cannot publish the report'
);

reset role;
update public.workflow_work_items
set processing_expires_at = statement_timestamp() - interval '1 second'
where id = (select work_item_id from m5_review_claim);
update public.total_loss_package_jobs
set processing_expires_at = statement_timestamp() - interval '1 second'
where id = (select package_job_id from m5_review_claim);
set local role service_role;

create temporary table m5_review_recovery_claim on commit drop as
select * from public.claim_total_loss_report_review_work_item(
  (select work_item_id from m5_review_claim),
  'af000000-0000-4000-8000-000000000002'
);

select ok(
  (
    select outcome = 'claimed' and attempt_count = 2
      and ai_review_run_id = (select ai_review_run_id from m5_ai_begin)
      and release_disposition = 'AUTO_RELEASE_NO_DISPUTE_REFUND'
    from m5_review_recovery_claim
  ),
  'an expired post-AI lease is reclaimed with terminal review identity and disposition projected'
);

create temporary table m5_ai_recovered on commit drop as
select * from public.begin_total_loss_ai_review(
  (select work_item_id from m5_review_recovery_claim),
  'af000000-0000-4000-8000-000000000002',
  'openai', 'gpt-test-approved', '1', '1', repeat('9', 64)
);

select ok(
  (
    select outcome = 'existing' and review_status = 'completed'
      and ai_review_run_id = (select ai_review_run_id from m5_ai_begin)
      and returned_model_identifier = 'gpt-test-approved'
      and recommendation = 'PASS' and confidence = 'HIGH'
      and review_result is not null and output_digest = repeat('f', 64)
      and release_gate_manifest ->> 'disposition' =
        'AUTO_RELEASE_NO_DISPUTE_REFUND'
      and release_gate_digest = repeat('b', 64)
    from m5_ai_recovered
  ),
  'a logically identical completed AI run is reused across a rotated lease with its full immutable payload'
);

create temporary table m5_release on commit drop as
select * from public.resolve_total_loss_report_release(
  (select work_item_id from m5_review_claim),
  'af000000-0000-4000-8000-000000000002',
  (select ai_review_run_id from m5_ai_recovered)
);

select ok(
  (select outcome = 'completed'
     and disposition = 'AUTO_RELEASE_NO_DISPUTE_REFUND'
     and report_status = 'published' and package_status = 'refund_pending'
     and order_id is not null and payment_transaction_id is not null
     and refund_client_request_id = report_version_id
   from m5_release),
  'independent gate publishes the no-dispute report and returns stable refund identities'
);

select ok(
  (
    select outcome = 'refund_required'
      and refund_client_request_id = report_version_id
      and refund_request_id is null
    from public.resolve_total_loss_no_dispute_refund_recovery(
      (select report_version_id from m5_release)
    )
  ),
  'crash after publication can recover the exact pending refund identity'
);

create temporary table m5_refund on commit drop as
select * from public.reserve_total_loss_refund(
  (select case_id from m5_release),
  (select order_id from m5_release),
  (select payment_transaction_id from m5_release),
  (select refund_client_request_id from m5_release),
  'NO_MATERIAL_DISPUTE_SUPPORTED', 'retain'
);

select * from public.record_total_loss_refund_result(
  (select refund_request_id from m5_refund),
  're_m5_total_loss', 'evt_m5_total_loss', 'txn_m5_total_loss', null,
  'succeeded', statement_timestamp() - interval '1 second', null
);

select ok(
  (
    select outcome = 'completion_required'
      and refund_request_id = (select refund_request_id from m5_refund)
      and refund_status = 'succeeded' and access_policy = 'retain'
    from public.resolve_total_loss_no_dispute_refund_recovery(
      (select report_version_id from m5_release)
    )
  ),
  'refund-success crash recovery advances to the idempotent completion seam'
);

select ok(
  (
    select outcome = 'completed' and package_status = 'not_supportable'
      and workflow_phase = 'resolution'
      and workflow_task = 'no_dispute_resolved'
      and entitlement_status = 'refunded_access_retained'
    from public.complete_total_loss_no_dispute_refund(
      (select report_version_id from m5_release),
      (select refund_request_id from m5_refund)
    )
  ),
  'succeeded retained-access refund completes the no-dispute resolution'
);

select ok(
  (
    select outcome = 'existing' and package_status = 'not_supportable'
    from public.complete_total_loss_no_dispute_refund(
      (select report_version_id from m5_release),
      (select refund_request_id from m5_refund)
    )
  ),
  'duplicate no-dispute refund completion is a read-only success'
);

select ok(
  (
    select outcome = 'completed'
      and ai_review_run_id = (select ai_review_run_id from m5_ai_begin)
      and release_disposition = 'AUTO_RELEASE_NO_DISPUTE_REFUND'
    from public.claim_total_loss_report_review_work_item(
      (select work_item_id from m5_review_claim),
      'af000000-0000-4000-8000-000000000003'
    )
  ),
  'duplicate terminal review claims retain the AI run and release disposition needed for convergence'
);

grant select on m5_release, m5_generation_claim to authenticated;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*) from public.total_loss_report_versions
   where id = (select report_version_id from m5_release)),
  1::bigint,
  'the permanent owner can read the published report after retained-access refund'
);
select is(
  (select count(*) from public.total_loss_claim_documents
   where id = (select document_id from m5_generation_claim)),
  1::bigint,
  'the permanent owner can read published deliverable metadata'
);
select is(
  (select count(*) from storage.objects
   where bucket_id = 'case-deliverables'
     and name = (select storage_object_name from m5_generation_claim)),
  1::bigint,
  'the permanent owner can read only the published private deliverable object'
);

reset role;

create temporary table m5_stale_pdf_manifest on commit drop as
with unsigned_manifest as (
  select jsonb_build_object(
    'schemaVersion', '1', 'status', 'PASS',
    'reportVersionId', 'b4000000-0000-4000-8000-000000000002',
    'reportDigest', repeat('7', 64), 'rendererVersion', '1',
    'templateVersion', '1', 'filename', 'stale-report.pdf',
    'mediaType', 'application/pdf', 'pdfSha256', repeat('8', 64),
    'byteSize', 321
  ) as manifest
)
select manifest || jsonb_build_object(
  'manifestDigest', public.total_loss_canonical_jsonb_digest(manifest)
) as validation_manifest
from unsigned_manifest;

insert into public.total_loss_report_series (
  id, case_id, product_identifier, report_kind
) values (
  'b2000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000002',
  'total-loss-package', 'valuation-evidence-package'
);

insert into public.workflow_work_items (
  id, case_id, package_job_id, work_type, work_version, sequence_number,
  status, attempt_count, processing_token, completed_at, next_attempt_at
) values (
  'b1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000002',
  'a9000000-0000-4000-8000-000000000002',
  'total_loss_report_generate', '1', 1, 'completed', 1,
  'b0000000-0000-4000-8000-000000000002', statement_timestamp(),
  statement_timestamp()
);

insert into public.total_loss_claim_documents (
  id, case_id, document_kind, storage_bucket_id, storage_object_name,
  original_filename, media_type, byte_size, content_digest, status, sealed_at
) values (
  'b3000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000002',
  'valuation_evidence_report', 'case-deliverables',
  'cases/a2000000-0000-4000-8000-000000000002/reports/b2000000-0000-4000-8000-000000000002/v1/stale-report.pdf',
  'stale-report.pdf', 'application/pdf', 321, repeat('8', 64),
  'ready', statement_timestamp()
);

insert into public.total_loss_report_versions (
  id, case_id, report_series_id, version_number, final_assessment_id,
  preliminary_snapshot_id, document_id, renderer_version, template_version,
  schema_version, report, report_digest, status, package_job_id,
  source_snapshot_id, generation_work_item_id, source_snapshot_digest,
  assessment_digest, validation_version, validation_manifest, pdf_digest,
  pdf_byte_size, generated_at
) values (
  'b4000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000002',
  'b2000000-0000-4000-8000-000000000002', 1,
  'ab000000-0000-4000-8000-000000000002',
  'a6000000-0000-4000-8000-000000000002',
  'b3000000-0000-4000-8000-000000000002', '1', '1', '1',
  jsonb_build_object(
    'schemaVersion', '1',
    'identity', jsonb_build_object(
      'reportVersionId', 'b4000000-0000-4000-8000-000000000002'
    ),
    'reportDigest', repeat('7', 64)
  ),
  repeat('7', 64), 'validated',
  'a9000000-0000-4000-8000-000000000002',
  'aa000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000002', repeat('4', 64),
  repeat('6', 64), '1',
  (select validation_manifest from m5_stale_pdf_manifest),
  repeat('8', 64), 321, statement_timestamp()
);

insert into public.workflow_work_items (
  id, case_id, package_job_id, report_version_id, work_type, work_version,
  sequence_number, status, next_attempt_at
) values (
  'b5000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000002',
  'a9000000-0000-4000-8000-000000000002',
  'b4000000-0000-4000-8000-000000000002',
  'total_loss_report_review', '1', 1, 'queued', statement_timestamp()
);

update public.total_loss_report_versions
set review_work_item_id = 'b5000000-0000-4000-8000-000000000002'
where id = 'b4000000-0000-4000-8000-000000000002';
update public.total_loss_report_series
set current_report_version_id = 'b4000000-0000-4000-8000-000000000002'
where id = 'b2000000-0000-4000-8000-000000000002';
update public.total_loss_claim_workflows
set current_report_version_id = 'b4000000-0000-4000-8000-000000000002',
    current_task = 'report_review_queued', revision = revision + 1
where case_id = 'a2000000-0000-4000-8000-000000000002';
update public.total_loss_package_jobs
set status = 'waiting_ai_review', processing_expires_at = null,
    failure_code = null, retryable = null, finished_at = null
where id = 'a9000000-0000-4000-8000-000000000002';

set local role service_role;

create temporary table m5_stale_claim on commit drop as
select * from public.claim_total_loss_report_review_work_item(
  'b5000000-0000-4000-8000-000000000002',
  'b6000000-0000-4000-8000-000000000002'
);
create temporary table m5_stale_ai_begin on commit drop as
select * from public.begin_total_loss_ai_review(
  'b5000000-0000-4000-8000-000000000002',
  'b6000000-0000-4000-8000-000000000002',
  'openai', 'gpt-test-approved', '1', '1', repeat('9', 64)
);

reset role;
update public.total_loss_report_versions
set status = 'superseded'
where id = 'b4000000-0000-4000-8000-000000000002';
update public.total_loss_report_series
set current_report_version_id = null
where id = 'b2000000-0000-4000-8000-000000000002';
update public.total_loss_claim_workflows
set current_report_version_id = null, revision = revision + 1
where case_id = 'a2000000-0000-4000-8000-000000000002';
set local role service_role;

select ok(
  (
    select report_status = 'superseded'
      and package_is_current and not report_is_current and review_is_current
    from public.resolve_total_loss_report_release_context(
      'b5000000-0000-4000-8000-000000000002',
      'b6000000-0000-4000-8000-000000000002',
      (select ai_review_run_id from m5_stale_ai_begin)
    )
  ),
  'post-provider context exposes authoritative supersession for a deterministic NO_ACTION decision'
);

create temporary table m5_stale_payload on commit drop as
with payload as (
  select
    jsonb_build_object(
      'schemaVersion', '1',
      'reviewedTarget', jsonb_build_object(
        'caseId', claim.case_id::text,
        'sourceSnapshotId', claim.source_snapshot_id::text,
        'finalAssessmentId', claim.final_assessment_id::text,
        'reportVersionId', claim.report_version_id::text
      ),
      'reviewedDigests', jsonb_build_object(
        'inputDigest', repeat('9', 64),
        'sourceSnapshotDigest', repeat('4', 64),
        'finalAssessmentDigest', repeat('6', 64),
        'reportDigest', repeat('7', 64), 'pdfDigest', repeat('8', 64)
      ),
      'recommendation', 'PASS', 'confidence', 'HIGH'
    ) as review_result,
    jsonb_build_object(
      'schemaVersion', '1', 'disposition', 'NO_ACTION',
      'caseId', claim.case_id::text,
      'packageJobId', claim.package_job_id::text,
      'workItemId', claim.work_item_id::text,
      'reportVersionId', claim.report_version_id::text,
      'sourceSnapshotId', claim.source_snapshot_id::text,
      'finalAssessmentId', claim.final_assessment_id::text,
      'aiReviewRunId', begun.ai_review_run_id::text,
      'sourceSnapshotDigest', repeat('4', 64),
      'finalAssessmentDigest', repeat('6', 64),
      'reportDigest', repeat('7', 64), 'pdfDigest', repeat('8', 64),
      'inputDigest', repeat('9', 64), 'outputDigest', repeat('f', 64),
      'configuredModelIdentifier', 'gpt-test-approved',
      'returnedModelIdentifier', 'gpt-test-approved',
      'promptVersion', '1', 'reviewSchemaVersion', '1',
      'reasonCodes', jsonb_build_array('STALE_OR_SUPERSEDED_REVIEW')
    ) as gate
  from m5_stale_claim as claim
  cross join m5_stale_ai_begin as begun
)
select review_result, gate,
  public.total_loss_canonical_jsonb_digest(gate) as gate_digest
from payload;

select ok(
  (
    select outcome = 'completed' and review_status = 'completed'
    from m5_stale_payload as payload
    cross join lateral public.complete_total_loss_ai_review(
      'b5000000-0000-4000-8000-000000000002',
      'b6000000-0000-4000-8000-000000000002',
      (select ai_review_run_id from m5_stale_ai_begin),
      'completed', 'gpt-test-approved', 'PASS', 'HIGH',
      payload.review_result, repeat('f', 64), '{}'::jsonb, null,
      payload.gate, payload.gate_digest
    )
  ),
  'AI terminal facts can be sealed with a digest-bound NO_ACTION after authoritative supersession'
);

create temporary table m5_stale_release on commit drop as
select * from public.resolve_total_loss_report_release(
  'b5000000-0000-4000-8000-000000000002',
  'b6000000-0000-4000-8000-000000000002',
  (select ai_review_run_id from m5_stale_ai_begin)
);

select ok(
  (
    select outcome = 'completed' and disposition = 'NO_ACTION'
      and report_status = 'superseded' and package_status = 'processing'
      and workflow_task = 'report_reviewing'
      and (select status from public.workflow_work_items
           where id = work_item_id) = 'completed'
      and (select current_report_version_id
           from public.total_loss_claim_workflows where case_id = release.case_id) is null
    from m5_stale_release as release
  ),
  'NO_ACTION completes only the obsolete review work while preserving superseded report and current workflow state'
);

select is(
  (
    select outcome
    from public.resolve_total_loss_report_release(
      'b5000000-0000-4000-8000-000000000002',
      'b6000000-0000-4000-8000-000000000002',
      (select ai_review_run_id from m5_stale_ai_begin)
    )
  ),
  'existing'::text,
  'duplicate NO_ACTION release is a read-only convergence success'
);

select throws_ok(
  $$
    select * from public.resolve_total_loss_report_release(
      'b5000000-0000-4000-8000-000000000002',
      'b6000000-0000-4000-8000-000000000003',
      (select ai_review_run_id from m5_stale_ai_begin)
    )
  $$,
  '55000',
  'NO_ACTION release fence is stale.',
  'a different worker token cannot converge an obsolete NO_ACTION review'
);

create temporary table m5_orphan_pdf_manifest on commit drop as
with unsigned_manifest as (
  select jsonb_build_object(
    'schemaVersion', '1', 'status', 'PASS',
    'reportVersionId', 'c4000000-0000-4000-8000-000000000005',
    'reportDigest', repeat('7', 64), 'rendererVersion', '1',
    'templateVersion', '1', 'filename', 'orphan-report.pdf',
    'mediaType', 'application/pdf', 'pdfSha256', repeat('8', 64),
    'byteSize', 321
  ) as manifest
)
select manifest || jsonb_build_object(
  'manifestDigest', public.total_loss_canonical_jsonb_digest(manifest)
) as validation_manifest
from unsigned_manifest;

reset role;
insert into public.total_loss_report_series (
  id, case_id, product_identifier, report_kind
) values (
  'c2000000-0000-4000-8000-000000000005',
  'a2000000-0000-4000-8000-000000000005',
  'total-loss-package', 'valuation-evidence-package'
);
insert into public.workflow_work_items (
  id, case_id, package_job_id, work_type, work_version, sequence_number,
  status, attempt_count, processing_token, completed_at, next_attempt_at
) values (
  'c1000000-0000-4000-8000-000000000005',
  'a2000000-0000-4000-8000-000000000005',
  'a9000000-0000-4000-8000-000000000005',
  'total_loss_report_generate', '1', 1, 'completed', 1,
  'c0000000-0000-4000-8000-000000000005', statement_timestamp(),
  statement_timestamp()
);
insert into public.total_loss_claim_documents (
  id, case_id, document_kind, storage_bucket_id, storage_object_name,
  original_filename, media_type, byte_size, content_digest, status, sealed_at
) values (
  'c3000000-0000-4000-8000-000000000005',
  'a2000000-0000-4000-8000-000000000005',
  'valuation_evidence_report', 'case-deliverables',
  'cases/a2000000-0000-4000-8000-000000000005/reports/c2000000-0000-4000-8000-000000000005/v1/orphan-report.pdf',
  'orphan-report.pdf', 'application/pdf', 321, repeat('8', 64),
  'ready', statement_timestamp()
);
insert into public.total_loss_report_versions (
  id, case_id, report_series_id, version_number, final_assessment_id,
  preliminary_snapshot_id, document_id, renderer_version, template_version,
  schema_version, report, report_digest, status, package_job_id,
  source_snapshot_id, generation_work_item_id, source_snapshot_digest,
  assessment_digest, validation_version, validation_manifest, pdf_digest,
  pdf_byte_size, generated_at
) values (
  'c4000000-0000-4000-8000-000000000005',
  'a2000000-0000-4000-8000-000000000005',
  'c2000000-0000-4000-8000-000000000005', 1,
  'ab000000-0000-4000-8000-000000000005',
  'a6000000-0000-4000-8000-000000000005',
  'c3000000-0000-4000-8000-000000000005', '1', '1', '1',
  jsonb_build_object(
    'schemaVersion', '1',
    'identity', jsonb_build_object(
      'reportVersionId', 'c4000000-0000-4000-8000-000000000005'
    ),
    'reportDigest', repeat('7', 64)
  ),
  repeat('7', 64), 'validated',
  'a9000000-0000-4000-8000-000000000005',
  'aa000000-0000-4000-8000-000000000005',
  'c1000000-0000-4000-8000-000000000005', repeat('4', 64),
  repeat('6', 64), '1',
  (select validation_manifest from m5_orphan_pdf_manifest),
  repeat('8', 64), 321, statement_timestamp()
);
insert into public.workflow_work_items (
  id, case_id, package_job_id, report_version_id, work_type, work_version,
  sequence_number, status, next_attempt_at
) values (
  'c5000000-0000-4000-8000-000000000005',
  'a2000000-0000-4000-8000-000000000005',
  'a9000000-0000-4000-8000-000000000005',
  'c4000000-0000-4000-8000-000000000005',
  'total_loss_report_review', '1', 1, 'queued', statement_timestamp()
);
update public.total_loss_report_versions
set review_work_item_id = 'c5000000-0000-4000-8000-000000000005'
where id = 'c4000000-0000-4000-8000-000000000005';
update public.total_loss_report_series
set current_report_version_id = 'c4000000-0000-4000-8000-000000000005'
where id = 'c2000000-0000-4000-8000-000000000005';
update public.total_loss_claim_workflows
set current_report_version_id = 'c4000000-0000-4000-8000-000000000005',
    current_task = 'report_review_queued', revision = revision + 1
where case_id = 'a2000000-0000-4000-8000-000000000005';
update public.total_loss_package_jobs
set status = 'waiting_ai_review', processing_expires_at = null,
    failure_code = null, retryable = null, finished_at = null
where id = 'a9000000-0000-4000-8000-000000000005';

set local role service_role;
create temporary table m5_orphan_claim on commit drop as
select * from public.claim_total_loss_report_review_work_item(
  'c5000000-0000-4000-8000-000000000005',
  'c6000000-0000-4000-8000-000000000005'
);
create temporary table m5_orphan_first_run on commit drop as
select * from public.begin_total_loss_ai_review(
  'c5000000-0000-4000-8000-000000000005',
  'c6000000-0000-4000-8000-000000000005',
  'openai', 'gpt-test-approved', '1', '1', repeat('9', 64)
);

reset role;
update public.workflow_work_items
set processing_expires_at = statement_timestamp() - interval '1 second'
where id = 'c5000000-0000-4000-8000-000000000005';
update public.total_loss_package_jobs
set processing_expires_at = statement_timestamp() - interval '1 second'
where id = 'a9000000-0000-4000-8000-000000000005';
set local role service_role;

create temporary table m5_orphan_reclaim on commit drop as
select * from public.claim_total_loss_report_review_work_item(
  'c5000000-0000-4000-8000-000000000005',
  'c6000000-0000-4000-8000-000000000006'
);
create temporary table m5_orphan_second_run on commit drop as
select * from public.begin_total_loss_ai_review(
  'c5000000-0000-4000-8000-000000000005',
  'c6000000-0000-4000-8000-000000000006',
  'openai', 'gpt-test-approved', '1', '1', repeat('9', 64)
);

select ok(
  (
    select second.outcome = 'created' and second.attempt_number = 2
      and second.ai_review_run_id <> first.ai_review_run_id
      and (select status from public.total_loss_ai_review_runs
           where id = first.ai_review_run_id) = 'failed'
      and (select failure_code from public.total_loss_ai_review_runs
           where id = first.ai_review_run_id) = 'AI_REVIEW_LEASE_ORPHANED'
    from m5_orphan_first_run as first
    cross join m5_orphan_second_run as second
  ),
  'an expired processing AI attempt is terminalized before a new fenced attempt is created'
);

select * from public.fail_total_loss_report_work_item(
  'c5000000-0000-4000-8000-000000000005',
  'c6000000-0000-4000-8000-000000000006',
  'REPORT_REVIEW_PROVIDER_ERROR', 'retryable', 60
);

select ok(
  (
    select outcome = 'busy' and work_item_status = 'retryable_failed'
      and attempt_count = 2
    from public.claim_total_loss_report_review_work_item(
      'c5000000-0000-4000-8000-000000000005',
      'c6000000-0000-4000-8000-000000000007'
    )
  ),
  'review work also enforces its persisted retry delay before a new lease'
);

reset role;
update public.workflow_work_items
set status = 'completed', processing_expires_at = null,
    last_error_code = null, retryable = null,
    completed_at = statement_timestamp(), failed_at = null
where id = 'c5000000-0000-4000-8000-000000000005';
update public.total_loss_report_versions
set status = 'published', published_at = statement_timestamp()
where id = 'c4000000-0000-4000-8000-000000000005';
update public.total_loss_report_series
set current_report_version_id = 'c4000000-0000-4000-8000-000000000005',
    current_published_report_version_id = 'c4000000-0000-4000-8000-000000000005'
where id = 'c2000000-0000-4000-8000-000000000005';
update public.total_loss_package_jobs
set status = 'refund_pending', processing_expires_at = null,
    failure_code = null, retryable = null, finished_at = null
where id = 'a9000000-0000-4000-8000-000000000005';
update public.total_loss_claim_workflows
set current_report_version_id = 'c4000000-0000-4000-8000-000000000005',
    current_task = 'refund_pending', revision = revision + 1
where case_id = 'a2000000-0000-4000-8000-000000000005';

set local role service_role;
create temporary table m5_failed_refund on commit drop as
select * from public.reserve_total_loss_refund(
  'a2000000-0000-4000-8000-000000000005',
  'a7000000-0000-4000-8000-000000000005',
  'ac000000-0000-4000-8000-000000000005',
  'c4000000-0000-4000-8000-000000000005',
  'NO_MATERIAL_DISPUTE_SUPPORTED', 'retain'
);
select * from public.record_total_loss_refund_result(
  (select refund_request_id from m5_failed_refund),
  're_m5_failed', 'evt_m5_failed', null, null,
  'failed', statement_timestamp() - interval '1 second',
  'PROVIDER_REFUND_FAILED'
);

select ok(
  (
    select outcome = 'human_review_required'
      and package_status = 'refund_pending'
      and refund_status = 'failed' and access_policy = 'retain'
    from public.resolve_total_loss_no_dispute_refund_recovery(
      'c4000000-0000-4000-8000-000000000005'
    )
  ),
  'a terminal failed refund is projected as human remediation without revoking access'
);

select ok(
  (
    select outcome = 'completed' and refund_status = 'failed'
      and package_status = 'waiting_human_review'
      and workflow_task = 'exception_review'
      and entitlement_status = 'active'
      and (select status from public.total_loss_report_versions
           where id = remediation.report_version_id) = 'published'
    from public.hold_total_loss_no_dispute_refund_failure(
      'c4000000-0000-4000-8000-000000000005',
      (select refund_request_id from m5_failed_refund)
    ) as remediation
  ),
  'terminal refund remediation durably holds the package while preserving the published report and access'
);

select ok(
  (
    select outcome = 'existing' and package_status = 'waiting_human_review'
      and refund_request_id = (select refund_request_id from m5_failed_refund)
    from public.hold_total_loss_no_dispute_refund_failure(
      'c4000000-0000-4000-8000-000000000005'
    )
  ),
  'duplicate remediation derives the same refund identity and converges read-only'
);

set local role service_role;

create temporary table m5_validation_enqueue on commit drop as
select * from public.enqueue_total_loss_report_generation(
  'a9000000-0000-4000-8000-000000000004'
);
create temporary table m5_validation_claim on commit drop as
select * from public.claim_total_loss_report_generation_work_item(
  (select work_item_id from m5_validation_enqueue),
  'c1000000-0000-4000-8000-000000000004'
);

create temporary table m5_validation_failure on commit drop as
select * from public.fail_total_loss_report_work_item(
  (select work_item_id from m5_validation_claim),
  'c1000000-0000-4000-8000-000000000004',
  'REPORT_SCHEMA_VALIDATION_FAILED', 'human_review_required', 0
);

select ok(
  (
    select outcome = 'completed'
      and work_item_status = 'terminal_failed'
      and package_status = 'waiting_human_review'
      and report_status = 'failed'
      and release_review_id is not null
      and workflow_task = 'exception_review'
      and exists (
        select 1 from public.total_loss_release_reviews as release_review
        where release_review.id = failure.release_review_id
          and release_review.ai_review_run_id is null
          and release_review.status = 'queued'
      )
    from m5_validation_failure as failure
  ),
  'deterministic generation validation failure preserves the draft lineage in a staff-review hold'
);

reset role;

insert into public.total_loss_report_series (
  id, case_id, product_identifier, report_kind
) values (
  'd2000000-0000-4000-8000-000000000004',
  'a2000000-0000-4000-8000-000000000004',
  'cross-series-fixture', 'valuation-evidence-package'
);

insert into public.workflow_work_items (
  id, case_id, package_job_id, work_type, work_version, sequence_number,
  status, next_attempt_at
) values (
  'd1000000-0000-4000-8000-000000000004',
  'a2000000-0000-4000-8000-000000000004',
  'a9000000-0000-4000-8000-000000000004',
  'total_loss_report_generate', '1', 99, 'queued', statement_timestamp()
);

insert into public.total_loss_claim_documents (
  id, case_id, document_kind, storage_bucket_id, storage_object_name,
  original_filename, media_type, status
) values (
  'd3000000-0000-4000-8000-000000000004',
  'a2000000-0000-4000-8000-000000000004',
  'valuation_evidence_report', 'case-deliverables',
  'cases/a2000000-0000-4000-8000-000000000004/reports/d2000000-0000-4000-8000-000000000004/versions/d4000000-0000-4000-8000-000000000004/valuation-evidence-package.pdf',
  'valuation-evidence-package.pdf', 'application/pdf', 'pending'
);

insert into public.total_loss_report_versions (
  id, case_id, report_series_id, version_number, final_assessment_id,
  preliminary_snapshot_id, document_id, package_job_id, source_snapshot_id,
  generation_work_item_id, source_snapshot_digest, assessment_digest,
  status
) values (
  'd4000000-0000-4000-8000-000000000004',
  'a2000000-0000-4000-8000-000000000004',
  'd2000000-0000-4000-8000-000000000004', 1,
  'ab000000-0000-4000-8000-000000000004',
  'a6000000-0000-4000-8000-000000000004',
  'd3000000-0000-4000-8000-000000000004',
  'a9000000-0000-4000-8000-000000000004',
  'aa000000-0000-4000-8000-000000000004',
  'd1000000-0000-4000-8000-000000000004', repeat('4', 64),
  repeat('6', 64), 'draft'
);

update public.workflow_work_items
set report_version_id = 'd4000000-0000-4000-8000-000000000004'
where id = 'd1000000-0000-4000-8000-000000000004';

select throws_ok(
  $$
    update public.total_loss_release_reviews
    set status = 'resolved', decision = 'revision_requested',
        rationale = 'Invalid cross-series replacement.',
        resulting_report_version_id =
          'd4000000-0000-4000-8000-000000000004',
        resolved_by_user_id = 'a1000000-0000-4000-8000-000000000002',
        resolved_at = statement_timestamp()
    where id = (select release_review_id from m5_validation_failure)
  $$,
  '23514',
  'Release-review replacement report lineage is invalid.',
  'a resolved revision cannot point at a same-case report from another report series'
);

grant select on m5_validation_failure to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table m5_generation_failure_packet on commit drop as
select * from public.get_total_loss_release_review(
  (select release_review_id from m5_validation_failure)
);

select ok(
  (
    select review_status = 'queued'
      and ai_review_run_id is null
      and resulting_report_version_id is null
      and report_version_id = (select report_version_id from m5_validation_failure)
      and report_status = 'failed'
      and report is null and report_digest is null
      and validation_manifest is null and pdf_digest is null
      and review_result is null and release_gate_manifest is null
      and failure_stage = 'report_generation'
      and failure_code = 'REPORT_SCHEMA_VALIDATION_FAILED'
      and artifact_availability = jsonb_build_object(
        'report', false,
        'validationManifest', false,
        'pdf', false,
        'aiReview', false,
        'reviewResult', false,
        'releaseGateManifest', false
      )
    from m5_generation_failure_packet
  ),
  'staff GET truthfully projects a generation failure with null artifacts and no fabricated availability'
);

create temporary table m5_revision_decision on commit drop as
select * from public.decide_total_loss_release_review(
  (select release_review_id from m5_generation_failure_packet),
  (select updated_at from m5_generation_failure_packet),
  'revision_requested',
  'Regenerate the report from the preserved assessment lineage.'
);

select ok(
  (
    select outcome = 'completed' and decision = 'revision_requested'
      and report_version_id =
        (select report_version_id from m5_generation_failure_packet)
      and resulting_report_version_id is not null
      and resulting_report_version_id <> report_version_id
      and report_status = 'failed'
      and package_status = 'assessment_ready'
      and workflow_task = 'report_generation_queued'
      and generation_work_item_id is not null
    from m5_revision_decision
  ),
  'a staff revision atomically returns the exact pre-reserved replacement report and generation work'
);

create temporary table m5_revision_replay on commit drop as
select * from public.decide_total_loss_release_review(
  (select release_review_id from m5_generation_failure_packet),
  (select updated_at from m5_generation_failure_packet),
  'revision_requested',
  'Regenerate the report from the preserved assessment lineage.'
);

select ok(
  (
    select replay.outcome = 'existing'
      and replay.report_version_id = decided.report_version_id
      and replay.resulting_report_version_id = decided.resulting_report_version_id
      and replay.generation_work_item_id = decided.generation_work_item_id
    from m5_revision_replay as replay
    cross join m5_revision_decision as decided
  ),
  'an identical staff decision replay returns the existing report and work identities'
);

select throws_ok(
  $$
    select * from public.decide_total_loss_release_review(
      (select release_review_id from m5_generation_failure_packet),
      (select updated_at from m5_generation_failure_packet),
      'revision_requested',
      'A conflicting replay rationale.'
    )
  $$,
  '55000',
  'Release review was already resolved differently.',
  'a non-identical replay cannot rewrite a resolved staff decision'
);

grant select on m5_generation_failure_packet, m5_revision_decision,
  m5_revision_replay to service_role;

reset role;

select ok(
  (
    select replacement.case_id = original.case_id
      and replacement.report_series_id = original.report_series_id
      and replacement.source_snapshot_id = original.source_snapshot_id
      and replacement.final_assessment_id = original.final_assessment_id
      and replacement.preliminary_snapshot_id = original.preliminary_snapshot_id
      and replacement.package_job_id = original.package_job_id
      and replacement.source_snapshot_digest = original.source_snapshot_digest
      and replacement.assessment_digest = original.assessment_digest
      and replacement.supersedes_report_version_id = original.id
      and replacement.version_number = original.version_number + 1
      and replacement.status = 'draft'
      and original.status = 'failed'
      and original.failure_code = 'REPORT_GENERATION_VALIDATION_FAILED'
      and document.case_id = original.case_id
      and document.status = 'pending'
      and document.storage_bucket_id = 'case-deliverables'
      and document.original_filename = 'valuation-evidence-package.pdf'
      and document.storage_object_name =
        'cases/' || replacement.case_id::text || '/reports/' ||
        replacement.report_series_id::text || '/versions/' ||
        replacement.id::text || '/valuation-evidence-package.pdf'
      and work_item.id = decision.generation_work_item_id
      and work_item.report_version_id = replacement.id
      and work_item.status = 'queued'
      and report_series.current_report_version_id = replacement.id
      and workflow.current_report_version_id = replacement.id
      and workflow.current_task = 'report_generation_queued'
      and release_review.resulting_report_version_id = replacement.id
      and (
        select count(*)
        from public.total_loss_report_versions as series_version
        where series_version.report_series_id = original.report_series_id
      ) = 2
      and (
        select count(*)
        from public.workflow_work_items as replacement_work
        where replacement_work.report_version_id = replacement.id
          and replacement_work.work_type = 'total_loss_report_generate'
      ) = 1
    from m5_revision_decision as decision
    join public.total_loss_report_versions as original
      on original.id = decision.report_version_id
    join public.total_loss_report_versions as replacement
      on replacement.id = decision.resulting_report_version_id
    join public.total_loss_claim_documents as document
      on document.id = replacement.document_id
    join public.workflow_work_items as work_item
      on work_item.id = replacement.generation_work_item_id
    join public.total_loss_report_series as report_series
      on report_series.id = replacement.report_series_id
    join public.total_loss_claim_workflows as workflow
      on workflow.case_id = replacement.case_id
    join public.total_loss_release_reviews as release_review
      on release_review.id = decision.release_review_id
  ),
  'revision and replay preserve direct lineage, original failure, canonical storage, and exact current pointers without duplicate rows'
);

set local role service_role;

create temporary table m5_revision_claim on commit drop as
select claim.*
from m5_revision_decision as decision
cross join lateral public.claim_total_loss_report_generation_work_item(
  decision.generation_work_item_id,
  'd5000000-0000-4000-8000-000000000004'
) as claim;

select ok(
  (
    select claim.outcome = 'claimed'
      and claim.work_item_id = decision.generation_work_item_id
      and claim.report_version_id = decision.resulting_report_version_id
      and claim.document_id = report_version.document_id
      and claim.report_version_number = report_version.version_number
      and claim.storage_bucket_id = 'case-deliverables'
      and claim.original_filename = 'valuation-evidence-package.pdf'
      and claim.storage_object_name =
        'cases/' || claim.case_id::text || '/reports/' ||
        claim.report_series_id::text || '/versions/' ||
        claim.report_version_id::text || '/valuation-evidence-package.pdf'
    from m5_revision_claim as claim
    cross join m5_revision_decision as decision
    join public.total_loss_report_versions as report_version
      on report_version.id = decision.resulting_report_version_id
  ),
  'claiming revision work reuses the exact report, document, version, and canonical path reserved by the staff decision'
);

create temporary table m5_retry_enqueue on commit drop as
select * from public.enqueue_total_loss_report_generation(
  'a9000000-0000-4000-8000-000000000003'
);
create temporary table m5_retry_claim on commit drop as
select * from public.claim_total_loss_report_generation_work_item(
  (select work_item_id from m5_retry_enqueue),
  'ad000000-0000-4000-8000-000000000002'
);

select ok(
  (
    select outcome = 'completed' and work_item_status = 'retryable_failed'
      and package_status = 'retryable_failed' and next_attempt_at is not null
    from public.fail_total_loss_report_work_item(
      (select work_item_id from m5_retry_claim),
      'ad000000-0000-4000-8000-000000000002',
      'PROVIDER_TIMEOUT', 'retryable', 1
    )
  ),
  'retryable operational failure releases both fences under bounded policy'
);

select ok(
  (
    select outcome = 'busy' and work_item_status = 'retryable_failed'
      and attempt_count = 1
    from public.claim_total_loss_report_generation_work_item(
      (select work_item_id from m5_retry_claim),
      'ad000000-0000-4000-8000-000000000003'
    )
  ),
  'retryable report work cannot be reclaimed before its durable retry delay elapses'
);

reset role;
update public.workflow_work_items
set next_attempt_at = statement_timestamp() - interval '1 second'
where id = (select work_item_id from m5_retry_claim);
set local role service_role;

create temporary table m5_retry_reclaim on commit drop as
select * from public.claim_total_loss_report_generation_work_item(
  (select work_item_id from m5_retry_claim),
  'ad000000-0000-4000-8000-000000000003'
);

select ok(
  (
    select replay.report_version_id = original.report_version_id
      and replay.document_id = original.document_id
      and replay.storage_object_name = original.storage_object_name
      and replay.generated_at = original.generated_at
      and replay.processing_token = 'ad000000-0000-4000-8000-000000000003'
    from m5_retry_claim as original
    cross join m5_retry_reclaim as replay
  ),
  'retry claim rotates both fences while preserving stable report/document identities'
);

select ok(
  (
    select outcome = 'completed' and work_item_status = 'retryable_failed'
      and package_status = 'retryable_failed'
    from public.fail_total_loss_report_work_item(
      (select work_item_id from m5_retry_reclaim),
      'ad000000-0000-4000-8000-000000000003',
      'PROVIDER_TIMEOUT', 'retryable', 1
    )
  ),
  'a second operational failure remains retryable while the bounded attempt budget remains'
);

reset role;
update public.workflow_work_items
set next_attempt_at = statement_timestamp() - interval '1 second'
where id = (select work_item_id from m5_retry_claim);
set local role service_role;

create temporary table m5_retry_final_claim on commit drop as
select * from public.claim_total_loss_report_generation_work_item(
  (select work_item_id from m5_retry_claim),
  'ad000000-0000-4000-8000-000000000004'
);

select ok(
  (
    select outcome = 'completed'
      and work_item_status = 'terminal_failed'
      and package_status = 'waiting_human_review'
      and report_status = 'failed'
      and release_review_id is not null
      and (select attempt_count from public.workflow_work_items
           where id = failure.work_item_id) = 3
    from public.fail_total_loss_report_work_item(
      (select work_item_id from m5_retry_final_claim),
      'ad000000-0000-4000-8000-000000000004',
      'PROVIDER_TIMEOUT', 'retryable', 1
    ) as failure
  ),
  'the third failed generation attempt deterministically exhausts into a staff hold'
);

select throws_ok(
  $$
    select * from public.complete_total_loss_report_generation(
      (select work_item_id from m5_retry_claim),
      'ad000000-0000-4000-8000-000000000002',
      '{}'::jsonb, repeat('1',64), '1','1','1','1','{}'::jsonb,1,repeat('2',64)
    )
  $$,
  '55000',
  'Report-generation completion fence is stale.',
  'the stale pre-retry worker cannot complete against the rotated dual fence'
);

select * from finish();
rollback;
