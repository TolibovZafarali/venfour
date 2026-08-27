begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(50);

select ok(
  to_regclass('public.workflow_work_items') is not null
    and to_regclass('public.total_loss_source_snapshots') is not null,
  'durable work items and immutable commercial source snapshots exist'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'total_loss_final_assessments'
      and column_name = 'source_snapshot_id'
  )
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'total_loss_source_snapshots'
        and column_name = 'snapshot_created_at'
        and is_nullable = 'NO'
    )
    and position(
      'source_frozen' in pg_get_constraintdef(
        (
          select constraint_row.oid
          from pg_constraint as constraint_row
          where constraint_row.conname = 'total_loss_package_jobs_status_valid'
        )
      )
    ) > 0,
  'final assessments carry frozen-source lineage and package jobs expose M4 states'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_class as relation
    where relation.oid = 'public.workflow_work_items'::regclass
  )
    and (
      select relation.relrowsecurity
      from pg_class as relation
      where relation.oid = 'public.total_loss_source_snapshots'::regclass
    ),
  'both private processing tables have RLS enabled'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('workflow_work_items', 'total_loss_source_snapshots')
  ),
  'private processing tables expose no browser policy'
);

select ok(
  has_table_privilege('service_role', 'public.workflow_work_items', 'SELECT')
    and not has_table_privilege('service_role', 'public.workflow_work_items', 'INSERT,UPDATE,DELETE')
    and has_table_privilege('service_role', 'public.total_loss_source_snapshots', 'SELECT')
    and not has_table_privilege('service_role', 'public.total_loss_source_snapshots', 'INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'public.workflow_work_items', 'SELECT')
    and not has_table_privilege('anon', 'public.total_loss_source_snapshots', 'SELECT'),
  'workers can inspect private rows but all processing writes remain RPC-only'
);

select ok(
  to_regprocedure('public.enqueue_total_loss_package_job(uuid)') is not null
    and to_regprocedure('public.reserve_due_workflow_work_items(uuid,integer)') is not null
    and to_regprocedure('public.reconcile_total_loss_package_work_items(uuid,integer)') is not null
    and to_regprocedure('public.mark_workflow_work_item_dispatched(uuid,uuid)') is not null
    and to_regprocedure('public.release_workflow_work_item_dispatch(uuid,uuid,text,integer)') is not null
    and to_regprocedure('public.claim_total_loss_package_work_item(uuid,uuid)') is not null
    and to_regprocedure('public.resolve_total_loss_package_source_context(uuid,uuid)') is not null
    and to_regprocedure('public.seal_total_loss_source_snapshot(uuid,uuid,uuid,text,bigint,text,text,text,date,timestamptz,text,jsonb,text)') is not null
    and to_regprocedure('public.persist_total_loss_final_assessment(uuid,uuid,uuid,text,text,bigint,bigint,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,text)') is not null
    and to_regprocedure('public.complete_total_loss_package_work_item(uuid,uuid,uuid,text,text)') is not null
    and to_regprocedure('public.fail_total_loss_package_work_item(uuid,uuid,text,text,integer)') is not null,
  'the exact narrow package-processing RPC surface exists'
);

select ok(
  (
    select count(*) = 11
      and bool_and(procedure.prosecdef)
      and bool_and('search_path=""' = any(procedure.proconfig))
    from pg_proc as procedure
    where procedure.oid = any (array[
      'public.enqueue_total_loss_package_job(uuid)'::regprocedure,
      'public.reserve_due_workflow_work_items(uuid,integer)'::regprocedure,
      'public.reconcile_total_loss_package_work_items(uuid,integer)'::regprocedure,
      'public.mark_workflow_work_item_dispatched(uuid,uuid)'::regprocedure,
      'public.release_workflow_work_item_dispatch(uuid,uuid,text,integer)'::regprocedure,
      'public.claim_total_loss_package_work_item(uuid,uuid)'::regprocedure,
      'public.resolve_total_loss_package_source_context(uuid,uuid)'::regprocedure,
      'public.seal_total_loss_source_snapshot(uuid,uuid,uuid,text,bigint,text,text,text,date,timestamptz,text,jsonb,text)'::regprocedure,
      'public.persist_total_loss_final_assessment(uuid,uuid,uuid,text,text,bigint,bigint,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,text)'::regprocedure,
      'public.complete_total_loss_package_work_item(uuid,uuid,uuid,text,text)'::regprocedure,
      'public.fail_total_loss_package_work_item(uuid,uuid,text,text,integer)'::regprocedure
    ])
  ),
  'all package-processing RPCs are security-definer functions with empty search paths'
);

select ok(
  has_function_privilege('service_role', 'public.enqueue_total_loss_package_job(uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.seal_total_loss_source_snapshot(uuid,uuid,uuid,text,bigint,text,text,text,date,timestamptz,text,jsonb,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.persist_total_loss_final_assessment(uuid,uuid,uuid,text,text,bigint,bigint,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.enqueue_total_loss_package_job(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.complete_total_loss_package_work_item(uuid,uuid,uuid,text,text)', 'EXECUTE'),
  'only service_role can execute authoritative package mutations'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.workflow_work_items'::regclass
      and tgname = 'workflow_work_items_protect_terminal'
      and not tgisinternal
  )
    and exists (
      select 1 from pg_trigger
      where tgrelid = 'public.total_loss_source_snapshots'::regclass
        and tgname = 'total_loss_source_snapshots_reject_mutation'
        and not tgisinternal
    )
    and exists (
      select 1 from pg_trigger
      where tgrelid = 'public.total_loss_package_jobs'::regclass
        and tgname = 'total_loss_package_jobs_protect_m4_terminal'
        and not tgisinternal
    ),
  'durable terminal state and frozen evidence are trigger-protected'
);

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values ('f1000000-0000-4000-8000-000000000001', 'package@example.test', statement_timestamp(), false);

create function pg_temp.create_package_case(
  requested_case_id uuid,
  requested_input_id uuid,
  requested_analysis_job_id uuid,
  requested_analysis_run_id uuid,
  requested_preliminary_snapshot_id uuid,
  requested_order_id uuid,
  requested_entitlement_id uuid
)
returns void
language plpgsql
as $$
begin
  insert into public.appraisal_cases (id, user_id, service_type, status)
  values (
    requested_case_id,
    'f1000000-0000-4000-8000-000000000001',
    'total_loss',
    'check_complete'
  );

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
    requested_case_id, 'Package Customer', 'package@example.test',
    '2026-08-23', statement_timestamp(), '2026-08-23', statement_timestamp(),
    false, statement_timestamp()
  );

  insert into public.total_loss_analysis_jobs (
    id, case_id, source_report_upload_id, source_details_updated_at, status,
    attempt_count, processing_token, processing_expires_at, run_id,
    failure_code, retryable, finished_at, source_intake_mode,
    source_analysis_input_revision, source_analysis_input_id
  ) values (
    requested_analysis_job_id, requested_case_id, null, statement_timestamp(),
    'completed', 1, gen_random_uuid(), null, requested_analysis_run_id, null,
    null, statement_timestamp(), 'manual', 1, requested_input_id
  );

  insert into public.analysis_runs (
    id, job_id, case_id, artifact, request_digest,
    analysis_run_schema_version, analysis_version,
    discrepancy_analysis_version, comparable_scoring_version
  ) values (
    requested_analysis_run_id, requested_analysis_job_id, requested_case_id,
    jsonb_build_object(
      'runId', requested_analysis_run_id::text,
      'requestDigest', repeat('1', 64),
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
    source_intake_mode, source_report_upload_id,
    source_analysis_input_revision, source_analysis_input_id,
    preliminary_classification, insurer_valuation_minor_units,
    supported_range_low_minor_units, supported_range_median_minor_units,
    supported_range_high_minor_units, currency, analysis_run_schema_version,
    analysis_version, discrepancy_analysis_version,
    comparable_scoring_version, presentation_schema_version,
    snapshot_schema_version, source_references, snapshot, snapshot_digest
  ) values (
    requested_preliminary_snapshot_id, requested_case_id,
    requested_analysis_job_id, requested_analysis_run_id,
    'f1000000-0000-4000-8000-000000000001', 'manual', null, 1,
    requested_input_id, 'MATERIAL_UNDERVALUE_SIGNAL', 1800000, 2000000,
    2100000, 2200000, 'USD', '4', '4', '1', '1', '1', '1',
    jsonb_build_object('analysisRunId', requested_analysis_run_id::text),
    jsonb_build_object('classification', 'MATERIAL_UNDERVALUE_SIGNAL'),
    repeat('2', 64)
  );

  insert into public.total_loss_claim_workflows (
    case_id, preliminary_snapshot_id, phase, current_task
  ) values (
    requested_case_id, requested_preliminary_snapshot_id, 'review',
    'purchase_complete'
  );

  insert into public.commerce_orders (
    id, case_id, purchaser_user_id, preliminary_snapshot_id,
    product_identifier, product_version, amount_minor_units, currency,
    payment_provider, external_price_identifier, provider_livemode,
    purchaser_email, status, terms_version, refund_policy_version, paid_at
  ) values (
    requested_order_id, requested_case_id,
    'f1000000-0000-4000-8000-000000000001',
    requested_preliminary_snapshot_id, 'total-loss-package', '1', 9900,
    'USD', 'stripe', 'price_test_total_loss_v1', false,
    'package@example.test', 'paid', 'terms-1', 'refund-1',
    statement_timestamp()
  );

  insert into public.case_entitlements (
    id, case_id, order_id, preliminary_snapshot_id, product_identifier,
    product_version, status
  ) values (
    requested_entitlement_id, requested_case_id, requested_order_id,
    requested_preliminary_snapshot_id, 'total-loss-package', '1', 'active'
  );
end;
$$;

select pg_temp.create_package_case(
  'f2000000-0000-4000-8000-000000000001',
  'f3000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000001',
  'f5000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001',
  'f7000000-0000-4000-8000-000000000001',
  'f8000000-0000-4000-8000-000000000001'
);

select pg_temp.create_package_case(
  'f2000000-0000-4000-8000-000000000002',
  'f3000000-0000-4000-8000-000000000002',
  'f4000000-0000-4000-8000-000000000002',
  'f5000000-0000-4000-8000-000000000002',
  'f6000000-0000-4000-8000-000000000002',
  'f7000000-0000-4000-8000-000000000002',
  'f8000000-0000-4000-8000-000000000002'
);

select pg_temp.create_package_case(
  'f2000000-0000-4000-8000-000000000003',
  'f3000000-0000-4000-8000-000000000003',
  'f4000000-0000-4000-8000-000000000003',
  'f5000000-0000-4000-8000-000000000003',
  'f6000000-0000-4000-8000-000000000003',
  'f7000000-0000-4000-8000-000000000003',
  'f8000000-0000-4000-8000-000000000003'
);

select pg_temp.create_package_case(
  'f2000000-0000-4000-8000-000000000004',
  'f3000000-0000-4000-8000-000000000004',
  'f4000000-0000-4000-8000-000000000004',
  'f5000000-0000-4000-8000-000000000004',
  'f6000000-0000-4000-8000-000000000004',
  'f7000000-0000-4000-8000-000000000004',
  'f8000000-0000-4000-8000-000000000004'
);

update public.case_entitlements
set status = 'suspended'
where id = 'f8000000-0000-4000-8000-000000000003';

update public.case_entitlements
set
  status = 'revoked',
  revoked_at = statement_timestamp(),
  reason_code = 'TEST_REVOKED'
where id = 'f8000000-0000-4000-8000-000000000004';

set local role service_role;

select is(
  (
    select count(*)
    from public.enqueue_total_loss_package_job(
      'f8000000-0000-4000-8000-000000000099'
    )
  ),
  0::bigint,
  'an unknown entitlement creates no package or work item'
);

select throws_ok(
  $$
    select * from public.enqueue_total_loss_package_job(
      'f8000000-0000-4000-8000-000000000003'
    )
  $$,
  '55000',
  'Entitlement is not eligible for package processing.',
  'a suspended entitlement cannot create package work'
);

select ok(
  not exists (
    select 1
    from public.total_loss_package_jobs
    where entitlement_id = 'f8000000-0000-4000-8000-000000000003'
  ),
  'suspended entitlement rejection leaves no package job'
);

select throws_ok(
  $$
    select * from public.enqueue_total_loss_package_job(
      'f8000000-0000-4000-8000-000000000004'
    )
  $$,
  '55000',
  'Entitlement is not eligible for package processing.',
  'a revoked entitlement cannot create package work'
);

select ok(
  not exists (
    select 1
    from public.total_loss_package_jobs
    where entitlement_id = 'f8000000-0000-4000-8000-000000000004'
  ),
  'revoked entitlement rejection leaves no package job'
);

select ok(
  (
    select outcome = 'created'
      and package_status = 'queued'
      and work_item_status = 'queued'
      and package_job_id is not null
      and work_item_id is not null
    from public.enqueue_total_loss_package_job(
      'f8000000-0000-4000-8000-000000000001'
    )
  ),
  'eligible paid entitlement atomically enqueues one package and work item'
);

select ok(
  (
    select count(*) = 1
    from public.total_loss_package_jobs
    where entitlement_id = 'f8000000-0000-4000-8000-000000000001'
  )
    and (
      select count(*) = 1
      from public.workflow_work_items as work_item
      join public.total_loss_package_jobs as package_job
        on package_job.id = work_item.package_job_id
      where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
    )
    and (
      select current_task = 'package_queued'
        and current_package_job_id is not null
      from public.total_loss_claim_workflows
      where case_id = 'f2000000-0000-4000-8000-000000000001'
    ),
  'enqueue commits the package, outbox work, and dedicated workflow pointer together'
);

select ok(
  (
    select outcome = 'existing'
    from public.enqueue_total_loss_package_job(
      'f8000000-0000-4000-8000-000000000001'
    )
  )
    and (
      select count(*) = 1
      from public.workflow_work_items as work_item
      join public.total_loss_package_jobs as package_job
        on package_job.id = work_item.package_job_id
      where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
    ),
  'enqueue replay returns the existing identities without duplicate work'
);

select ok(
  (
    select count(*) = 1
      and bool_and(dispatch_attempt_count = 1)
    from public.reserve_due_workflow_work_items(
      'fa000000-0000-4000-8000-000000000001', 1
    )
  ),
  'dispatcher reserves one due item under a bounded dispatch token'
);

select is(
  public.mark_workflow_work_item_dispatched(
    (
      select work_item.id
      from public.workflow_work_items as work_item
      join public.total_loss_package_jobs as package_job
        on package_job.id = work_item.package_job_id
      where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
    ),
    'fa000000-0000-4000-8000-000000000001'
  ),
  true,
  'dispatch acknowledgement releases only the winning dispatch fence'
);

select ok(
  (
    select outcome = 'claimed'
      and package_status = 'processing'
      and work_item_status = 'processing'
      and attempt_count = 1
      and processing_token = 'fb000000-0000-4000-8000-000000000001'
    from public.claim_total_loss_package_work_item(
      (
        select work_item.id
        from public.workflow_work_items as work_item
        join public.total_loss_package_jobs as package_job
          on package_job.id = work_item.package_job_id
        where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
      ),
      'fb000000-0000-4000-8000-000000000001'
    )
  ),
  'claim atomically establishes matching work-item and package-job leases'
);

select ok(
  (
    select outcome = 'claimed'
      and attempt_count = 1
      and processing_token = 'fb000000-0000-4000-8000-000000000001'
    from public.claim_total_loss_package_work_item(
      (
        select work_item.id
        from public.workflow_work_items as work_item
        join public.total_loss_package_jobs as package_job
          on package_job.id = work_item.package_job_id
        where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
      ),
      'fb000000-0000-4000-8000-000000000001'
    )
  ),
  'same-token claim replay preserves the existing lease and attempt number'
);

select ok(
  (
    select outcome = 'busy'
      and processing_token = 'fb000000-0000-4000-8000-000000000001'
    from public.claim_total_loss_package_work_item(
      (
        select work_item.id
        from public.workflow_work_items as work_item
        join public.total_loss_package_jobs as package_job
          on package_job.id = work_item.package_job_id
        where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
      ),
      'fb000000-0000-4000-8000-000000000099'
    )
  ),
  'a competing claim observes busy state and the winning processing token'
);

select is(
  (
    select count(*)
    from public.resolve_total_loss_package_source_context(
      (
        select work_item.id
        from public.workflow_work_items as work_item
        join public.total_loss_package_jobs as package_job
          on package_job.id = work_item.package_job_id
        where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
      ),
      'fb000000-0000-4000-8000-000000000099'
    )
  ),
  0::bigint,
  'stale workers cannot resolve source context'
);

select ok(
  (
    select lineage_current
      and product_identifier = 'total-loss-package'
      and product_version = '1'
      and source_intake_mode = 'manual'
      and source_analysis_input_id = 'f3000000-0000-4000-8000-000000000001'
    from public.resolve_total_loss_package_source_context(
      (
        select work_item.id
        from public.workflow_work_items as work_item
        join public.total_loss_package_jobs as package_job
          on package_job.id = work_item.package_job_id
        where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
      ),
      'fb000000-0000-4000-8000-000000000001'
    )
  ),
  'source context returns the exact product and current analysis-input lineage'
);

select ok(
  (
    select confirmed_facts is not null
      and normalized_extraction is null
      and storage_object_name is null
      and existing_source_snapshot_id is null
    from public.resolve_total_loss_package_source_context(
      (
        select work_item.id
        from public.workflow_work_items as work_item
        join public.total_loss_package_jobs as package_job
          on package_job.id = work_item.package_job_id
        where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
      ),
      'fb000000-0000-4000-8000-000000000001'
    )
  ),
  'manual source context contains confirmed facts but no report or prior freeze'
);

select ok(
  (
    select outcome = 'created'
      and source_snapshot_id = 'fc000000-0000-4000-8000-000000000001'
      and source_snapshot_digest = repeat('4', 64)
      and package_status = 'source_frozen'
    from public.seal_total_loss_source_snapshot(
      (
        select work_item.id
        from public.workflow_work_items as work_item
        join public.total_loss_package_jobs as package_job
          on package_job.id = work_item.package_job_id
        where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
      ),
      'fb000000-0000-4000-8000-000000000001',
      'fc000000-0000-4000-8000-000000000001',
      null, null, null, repeat('3', 64), null, '2026-08-20',
      '2026-08-26T12:00:00Z', '1',
      jsonb_build_object(
        'schemaVersion', '1',
        'createdAt', '2026-08-26T12:00:00Z',
        'lineage', jsonb_build_object(
          'caseId', 'f2000000-0000-4000-8000-000000000001',
          'packageJobId', (
            select id::text from public.total_loss_package_jobs
            where entitlement_id = 'f8000000-0000-4000-8000-000000000001'
          ),
          'entitlementId', 'f8000000-0000-4000-8000-000000000001',
          'preliminarySnapshotId', 'f6000000-0000-4000-8000-000000000001',
          'sourceSnapshotId', 'fc000000-0000-4000-8000-000000000001',
          'analysisJobId', 'f4000000-0000-4000-8000-000000000001',
          'analysisRunId', 'f5000000-0000-4000-8000-000000000001',
          'ownerUserIdAtCreation', 'f1000000-0000-4000-8000-000000000001',
          'productIdentifier', 'total-loss-package',
          'productVersion', '1'
        ),
        'input', jsonb_build_object(
          'intakeMode', 'MANUAL',
          'analysisInputRevision', 1,
          'analysisInputId', 'f3000000-0000-4000-8000-000000000001',
          'reportUploadId', null,
          'confirmedFacts', jsonb_build_object(),
          'inputDigest', repeat('9', 64)
        ),
        'sourceDocument', null,
        'extraction', null,
        'analysis', jsonb_build_object(
          'artifactDigest', repeat('3', 64),
          'requestDigest', repeat('1', 64)
        ),
        'preliminary', jsonb_build_object(
          'snapshotDigest', repeat('2', 64),
          'snapshotSchemaVersion', '1'
        ),
        'evidenceCutoff', jsonb_build_object(),
        'evidenceManifest', jsonb_build_array(),
        'validationManifest', jsonb_build_object(),
        'snapshotDigest', repeat('4', 64)
      ),
      repeat('4', 64)
    )
  ),
  'worker-selected stable source UUID and full canonical JSON are sealed together'
);

select ok(
  (
    select count(*) = 1
      and bool_and(id = 'fc000000-0000-4000-8000-000000000001')
      and bool_and(snapshot_digest = repeat('4', 64))
      and bool_and(source_snapshot #>> '{lineage,sourceSnapshotId}' = id::text)
    from public.total_loss_source_snapshots
    where case_id = 'f2000000-0000-4000-8000-000000000001'
  )
    and (
      select status = 'source_frozen'
      from public.total_loss_package_jobs
      where entitlement_id = 'f8000000-0000-4000-8000-000000000001'
    ),
  'sealed source preserves its embedded identity and advances only the package lease'
);

select ok(
  (
    select existing_source_snapshot_id = 'fc000000-0000-4000-8000-000000000001'
      and existing_source_snapshot = (
        select source_snapshot from public.total_loss_source_snapshots
        where id = 'fc000000-0000-4000-8000-000000000001'
      )
      and existing_source_snapshot_digest = repeat('4', 64)
    from public.resolve_total_loss_package_source_context(
      (
        select work_item.id
        from public.workflow_work_items as work_item
        join public.total_loss_package_jobs as package_job
          on package_job.id = work_item.package_job_id
        where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
      ),
      'fb000000-0000-4000-8000-000000000001'
    )
  ),
  'crash-after-source replay reloads the exact immutable canonical source object'
);

select ok(
  (
    select outcome = 'existing'
      and source_snapshot_id = 'fc000000-0000-4000-8000-000000000001'
    from public.seal_total_loss_source_snapshot(
      (
        select work_item.id
        from public.workflow_work_items as work_item
        join public.total_loss_package_jobs as package_job
          on package_job.id = work_item.package_job_id
        where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
      ),
      'fb000000-0000-4000-8000-000000000001',
      'fc000000-0000-4000-8000-000000000001', null, null, null,
      repeat('3', 64), null, '2026-08-20',
      '2026-08-26T12:00:00Z', '1',
      (
        select source_snapshot from public.total_loss_source_snapshots
        where id = 'fc000000-0000-4000-8000-000000000001'
      ),
      repeat('4', 64)
    )
  ),
  'exact source-seal replay returns the existing row'
);

select throws_ok(
  $$
    select public.seal_total_loss_source_snapshot(
      (
        select work_item.id
        from public.workflow_work_items as work_item
        join public.total_loss_package_jobs as package_job
          on package_job.id = work_item.package_job_id
        where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
      ),
      'fb000000-0000-4000-8000-000000000001',
      'fc000000-0000-4000-8000-000000000001', null, null, null,
      repeat('3', 64), null, '2026-08-20',
      '2026-08-26T12:00:00Z', '1',
      (
        select source_snapshot || jsonb_build_object('snapshotDigest', repeat('5', 64))
        from public.total_loss_source_snapshots
        where id = 'fc000000-0000-4000-8000-000000000001'
      ),
      repeat('5', 64)
    )
  $$,
  '55000',
  'Source snapshot replay conflicts with the immutable package source.',
  'conflicting source replay fails closed'
);

select ok(
  (
    select outcome = 'created'
      and final_assessment_id is not null
      and assessment_digest = repeat('6', 64)
    from public.persist_total_loss_final_assessment(
      (
        select work_item.id
        from public.workflow_work_items as work_item
        join public.total_loss_package_jobs as package_job
          on package_job.id = work_item.package_job_id
        where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
      ),
      'fb000000-0000-4000-8000-000000000001',
      'fc000000-0000-4000-8000-000000000001',
      'MATERIAL_UNDERVALUE_SIGNAL', 'USD', 2000000, 2100000, 2200000,
      jsonb_build_array(), jsonb_build_array(),
      jsonb_build_array('UNCHANGED_EVIDENCE'),
      jsonb_build_object('materialChange', false),
      jsonb_build_object(
        'schemaVersion', '1',
        'methodologyVersion', '1',
        'lineage', jsonb_build_object(
          'caseId', 'f2000000-0000-4000-8000-000000000001',
          'packageJobId', (
            select id::text from public.total_loss_package_jobs
            where entitlement_id = 'f8000000-0000-4000-8000-000000000001'
          ),
          'entitlementId', 'f8000000-0000-4000-8000-000000000001',
          'preliminarySnapshotId', 'f6000000-0000-4000-8000-000000000001',
          'sourceSnapshotId', 'fc000000-0000-4000-8000-000000000001',
          'analysisRunId', 'f5000000-0000-4000-8000-000000000001'
        ),
        'sourceSnapshotDigest', repeat('4', 64),
        'analysisArtifactDigest', repeat('3', 64),
        'finalClassification', 'MATERIAL_UNDERVALUE_SIGNAL',
        'findings', jsonb_build_array(),
        'limitations', jsonb_build_array(),
        'preliminaryToFinalComparison', jsonb_build_object('materialChange', false),
        'assessmentDigest', repeat('6', 64)
      ),
      '1', '1', repeat('6', 64)
    )
  ),
  'one assessment is persisted under the current source and worker fences'
);

select ok(
  (
    select count(*) = 1
      and bool_and(source_snapshot_id = 'fc000000-0000-4000-8000-000000000001')
      and bool_and(assessment #>> '{lineage,packageJobId}' = package_job_id::text)
    from public.total_loss_final_assessments
    where case_id = 'f2000000-0000-4000-8000-000000000001'
  ),
  'assessment relational and embedded source lineage agree'
);

select ok(
  (
    select replay_result.outcome = 'existing'
    from public.total_loss_final_assessments as final_assessment
    cross join lateral public.persist_total_loss_final_assessment(
      (
        select work_item.id
        from public.workflow_work_items as work_item
        join public.total_loss_package_jobs as package_job
          on package_job.id = work_item.package_job_id
        where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
      ),
      'fb000000-0000-4000-8000-000000000001',
      final_assessment.source_snapshot_id,
      final_assessment.conclusion_code,
      final_assessment.currency,
      final_assessment.supported_range_low_minor_units,
      final_assessment.supported_range_median_minor_units,
      final_assessment.supported_range_high_minor_units,
      final_assessment.findings,
      final_assessment.limitations,
      final_assessment.reason_codes,
      final_assessment.preliminary_to_final_comparison,
      final_assessment.assessment,
      final_assessment.methodology_version,
      final_assessment.schema_version,
      final_assessment.assessment_digest
    ) as replay_result
    where final_assessment.case_id = 'f2000000-0000-4000-8000-000000000001'
  ),
  'exact assessment replay returns the existing immutable assessment'
);

select throws_ok(
  $$
    select public.persist_total_loss_final_assessment(
      (
        select work_item.id
        from public.workflow_work_items as work_item
        join public.total_loss_package_jobs as package_job
          on package_job.id = work_item.package_job_id
        where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
      ),
      'fb000000-0000-4000-8000-000000000001',
      source_snapshot_id, conclusion_code, currency,
      supported_range_low_minor_units, supported_range_median_minor_units,
      supported_range_high_minor_units, findings, limitations, reason_codes,
      preliminary_to_final_comparison,
      assessment || jsonb_build_object('assessmentDigest', repeat('7', 64)),
      methodology_version, schema_version, repeat('7', 64)
    )
    from public.total_loss_final_assessments
    where case_id = 'f2000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'Final assessment replay conflicts with the immutable package assessment.',
  'conflicting assessment replay fails closed'
);

select is(
  public.complete_total_loss_package_work_item(
    (
      select work_item.id
      from public.workflow_work_items as work_item
      join public.total_loss_package_jobs as package_job
        on package_job.id = work_item.package_job_id
      where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
    ),
    'fb000000-0000-4000-8000-000000000001',
    (
      select id from public.total_loss_final_assessments
      where case_id = 'f2000000-0000-4000-8000-000000000001'
    ),
    'assessment_ready', null
  ),
  true,
  'winning worker atomically completes the assessed package'
);

select ok(
  (
    select package_job.status = 'assessment_ready'
      and work_item.status = 'completed'
      and workflow.current_task = 'awaiting_report_generation'
    from public.total_loss_package_jobs as package_job
    join public.workflow_work_items as work_item
      on work_item.package_job_id = package_job.id
    join public.total_loss_claim_workflows as workflow
      on workflow.current_package_job_id = package_job.id
    where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
  )
    and (
      select count(*) = 1
      from public.total_loss_workflow_events
      where case_id = 'f2000000-0000-4000-8000-000000000001'
        and event_type = 'package.assessment_completed'
    ),
  'completion terminalizes both records, advances workflow, and audits one event'
);

select is(
  public.complete_total_loss_package_work_item(
    (
      select work_item.id
      from public.workflow_work_items as work_item
      join public.total_loss_package_jobs as package_job
        on package_job.id = work_item.package_job_id
      where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
    ),
    'fb000000-0000-4000-8000-000000000001',
    (
      select id from public.total_loss_final_assessments
      where case_id = 'f2000000-0000-4000-8000-000000000001'
    ),
    'assessment_ready', null
  ),
  true,
  'exact terminal completion replay succeeds without another transition'
);

select is(
  public.fail_total_loss_package_work_item(
    (
      select work_item.id
      from public.workflow_work_items as work_item
      join public.total_loss_package_jobs as package_job
        on package_job.id = work_item.package_job_id
      where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000001'
    ),
    'fb000000-0000-4000-8000-000000000099',
    'STALE_WORKER', 'terminal', null
  ),
  false,
  'a stale token cannot overwrite completed terminal state'
);

select ok(
  (
    select outcome = 'created'
    from public.enqueue_total_loss_package_job(
      'f8000000-0000-4000-8000-000000000002'
    )
  ),
  'a second paid entitlement gets an independent durable work item'
);

select ok(
  (
    select outcome = 'claimed'
      and processing_token = 'fb000000-0000-4000-8000-000000000002'
    from public.claim_total_loss_package_work_item(
      (
        select work_item.id
        from public.workflow_work_items as work_item
        join public.total_loss_package_jobs as package_job
          on package_job.id = work_item.package_job_id
        where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000002'
      ),
      'fb000000-0000-4000-8000-000000000002'
    )
  ),
  'worker can directly claim an independently delivered queued task'
);

select is(
  public.fail_total_loss_package_work_item(
    (
      select work_item.id
      from public.workflow_work_items as work_item
      join public.total_loss_package_jobs as package_job
        on package_job.id = work_item.package_job_id
      where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000002'
    ),
    'fb000000-0000-4000-8000-000000000002',
    'SOURCE_LINEAGE_CONFLICT', 'review_required', null
  ),
  true,
  'bounded review-required failure is durably recorded under the winning fence'
);

select ok(
  (
    select package_job.status = 'review_required'
      and package_job.retryable = false
      and work_item.status = 'terminal_failed'
      and work_item.retryable = false
      and workflow.current_task = 'assessment_review_required'
    from public.total_loss_package_jobs as package_job
    join public.workflow_work_items as work_item
      on work_item.package_job_id = package_job.id
    join public.total_loss_claim_workflows as workflow
      on workflow.current_package_job_id = package_job.id
    where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000002'
  ),
  'review failure terminalizes execution and advances only the dedicated workflow'
);

select is(
  public.fail_total_loss_package_work_item(
    (
      select work_item.id
      from public.workflow_work_items as work_item
      join public.total_loss_package_jobs as package_job
        on package_job.id = work_item.package_job_id
      where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000002'
    ),
    'fb000000-0000-4000-8000-000000000002',
    'SOURCE_LINEAGE_CONFLICT', 'review_required', null
  ),
  true,
  'exact failure replay is idempotent'
);

select is(
  public.fail_total_loss_package_work_item(
    (
      select work_item.id
      from public.workflow_work_items as work_item
      join public.total_loss_package_jobs as package_job
        on package_job.id = work_item.package_job_id
      where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000002'
    ),
    'fb000000-0000-4000-8000-000000000099',
    'SOURCE_LINEAGE_CONFLICT', 'review_required', null
  ),
  false,
  'stale worker cannot replay another worker terminal failure'
);

select throws_ok(
  $$
    insert into public.total_loss_source_snapshots (
      id, case_id, package_job_id, entitlement_id, preliminary_snapshot_id,
      analysis_job_id, analysis_run_id, owner_user_id_at_creation,
      source_intake_mode, source_analysis_input_revision,
      extraction_available, analysis_artifact_digest,
      preliminary_snapshot_digest, request_digest, evidence_cutoff,
      snapshot_created_at, analysis_run_schema_version, analysis_version,
      discrepancy_analysis_version, comparable_scoring_version,
      presentation_schema_version, preliminary_snapshot_schema_version,
      snapshot_schema_version, source_snapshot, snapshot_digest
    )
    select
      gen_random_uuid(), package_job.case_id, package_job.id,
      package_job.entitlement_id, package_job.preliminary_snapshot_id,
      preliminary.analysis_job_id, preliminary.analysis_run_id,
      'f1000000-0000-4000-8000-000000000001', 'manual', 1, false,
      repeat('3', 64), repeat('2', 64), repeat('1', 64), '2026-08-20',
      statement_timestamp(), '4', '4', '1', '1', '1', '1', '1',
      '{}'::jsonb, repeat('8', 64)
    from public.total_loss_package_jobs as package_job
    join public.total_loss_preliminary_snapshots as preliminary
      on preliminary.id = package_job.preliminary_snapshot_id
    where package_job.entitlement_id = 'f8000000-0000-4000-8000-000000000002'
  $$,
  '42501', null,
  'service role cannot bypass source-snapshot RPC mutations'
);

reset role;

select throws_ok(
  $$
    update public.total_loss_source_snapshots
    set source_snapshot = source_snapshot
    where id = 'fc000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'total_loss_source_snapshots records are immutable.',
  'frozen source JSON cannot be rewritten even by a table owner'
);

select throws_ok(
  $$
    update public.total_loss_final_assessments
    set assessment = assessment
    where case_id = 'f2000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'total_loss_final_assessments records are immutable.',
  'final assessment JSON cannot be rewritten even by a table owner'
);

set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000001';

select results_eq(
  $$
    select next_task, workflow_current_task
    from public.resolve_total_loss_case_claim(
      'f2000000-0000-4000-8000-000000000001'
    )
  $$,
  $$values ('awaiting_report_generation'::text, 'awaiting_report_generation'::text)$$,
  'owner-safe resume projection follows completed M4 workflow instead of regressing to purchase_complete'
);

select results_eq(
  $$
    select next_task, workflow_current_task
    from public.resolve_total_loss_case_claim(
      'f2000000-0000-4000-8000-000000000002'
    )
  $$,
  $$values ('assessment_review_required'::text, 'assessment_review_required'::text)$$,
  'owner-safe resume projection exposes the package review boundary without work internals'
);

select throws_ok(
  $$select count(*) from public.workflow_work_items$$,
  '42501', null,
  'authenticated customers cannot read private orchestration rows'
);

select * from finish();
rollback;
