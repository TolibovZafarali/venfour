begin;create extension if not exists pgtap with schema extensions;set local search_path=public,extensions;select no_plan();
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


create temp table recovery_work as select * from public.enqueue_total_loss_package_job('f8000000-0000-4000-8000-000000000001');
create temp table dispatch as select gen_random_uuid() token;
select is((select count(*) from public.reserve_due_workflow_work_items((select token from dispatch),5)),1::bigint,'initial reservation');
select is(public.workflow_work_item_delivery_generation((select work_item_id from recovery_work),(select token from dispatch)),0,'legacy generation has no replacement yet');
select is(public.advance_workflow_work_item_delivery((select work_item_id from recovery_work),(select token from dispatch),0),1,'generation persisted before transport');
select is(public.advance_workflow_work_item_delivery((select work_item_id from recovery_work),(select token from dispatch),0),1,'ambiguous RPC replay cannot advance twice');
select throws_ok(format('select public.advance_workflow_work_item_delivery(%L,%L,0)',(select work_item_id from recovery_work),gen_random_uuid()),'55000','Dispatch fence is stale.','stale dispatcher cannot advance');
select ok(public.mark_workflow_work_item_dispatched((select work_item_id from recovery_work),(select token from dispatch)),'dispatch acknowledged');
select is((select outcome from public.claim_total_loss_package_work_item((select work_item_id from recovery_work),'fb000000-0000-4000-8000-000000000011')),'claimed','worker claims stable identity');
select ok((select processing_expires_at between statement_timestamp()+interval '16 minutes 59 seconds' and statement_timestamp()+interval '17 minutes' from public.workflow_work_items where id=(select work_item_id from recovery_work)),'lease is 17 minutes');
select is((select outcome from public.claim_total_loss_package_work_item((select work_item_id from recovery_work),gen_random_uuid())),'busy','duplicate cannot execute concurrently');
select is((select count(*) from public.reserve_due_workflow_work_items(gen_random_uuid(),5)),0::bigint,'scheduler never reclaims healthy lease');
update public.workflow_work_items set processing_expires_at=statement_timestamp()-interval '1 minute' where id=(select work_item_id from recovery_work);
update public.total_loss_package_jobs set processing_expires_at=statement_timestamp()-interval '1 minute' where id=(select package_job_id from recovery_work);
update dispatch set token=gen_random_uuid();
select is((select count(*) from public.reserve_due_workflow_work_items((select token from dispatch),5)),1::bigint,'scheduler recovers dead worker');
select is(public.advance_workflow_work_item_delivery((select work_item_id from recovery_work),(select token from dispatch),1),2,'replacement gets new task generation');
select is((select outcome from public.claim_total_loss_package_work_item((select work_item_id from recovery_work),'fb000000-0000-4000-8000-000000000012')),'claimed','replacement claims same work');
select ok(not public.fail_total_loss_package_work_item((select work_item_id from recovery_work),'fb000000-0000-4000-8000-000000000011','TEST_FAILURE','retryable',60),'late worker cannot commit failure');
update public.workflow_work_items set attempt_count=3,processing_expires_at=statement_timestamp()-interval '1 minute' where id=(select work_item_id from recovery_work);
update public.total_loss_package_jobs set processing_expires_at=statement_timestamp()-interval '1 minute' where id=(select package_job_id from recovery_work);
select is((select count(*) from public.reserve_due_workflow_work_items(gen_random_uuid(),5)),0::bigint,'execution exhaustion creates no replacement task');
select is((select status from public.workflow_work_items where id=(select work_item_id from recovery_work)),'terminal_failed','dead third worker becomes terminal');
select is((select outcome from public.claim_total_loss_package_work_item((select work_item_id from recovery_work),gen_random_uuid())),'terminal_failed','late delivery cannot restart exhausted work');
select is((select count(*) from public.total_loss_package_jobs where case_id='f2000000-0000-4000-8000-000000000001'),1::bigint,'one durable package');
select is((select count(*) from public.case_entitlements where case_id='f2000000-0000-4000-8000-000000000001'),1::bigint,'one fixture entitlement');
create temp table undispatched as select * from public.enqueue_total_loss_package_job('f8000000-0000-4000-8000-000000000002');
update dispatch set token=gen_random_uuid();
select is((select count(*) from public.reserve_due_workflow_work_items((select token from dispatch),5)),1::bigint,'new untouched fixture reserved');
select public.advance_workflow_work_item_delivery((select work_item_id from undispatched),(select token from dispatch),i) from generate_series(0,4) i;
select is(public.advance_workflow_work_item_delivery((select work_item_id from undispatched),(select token from dispatch),5),null::integer,'five lost deliveries stop further task creation');
select is((select attempt_count from public.workflow_work_items where id=(select work_item_id from undispatched)),0,'dispatch failure never pretends worker execution');
select is((select outcome from public.claim_total_loss_package_work_item((select work_item_id from undispatched),gen_random_uuid())),'terminal_failed','tombstoned late task cannot execute after delivery limit');
select ok(not has_function_privilege('anon','public.advance_workflow_work_item_delivery(uuid,uuid,integer)','EXECUTE'),'anonymous cannot dispatch');
select ok(not has_function_privilege('authenticated','public.workflow_work_item_delivery_generation(uuid,uuid)','EXECUTE'),'customer cannot inspect internal dispatch');
select ok(has_function_privilege('service_role','public.advance_workflow_work_item_delivery(uuid,uuid,integer)','EXECUTE'),'only backend can advance delivery');
select ok(not has_function_privilege('service_role','public.hold_exhausted_workflow_work_internal(uuid,text,boolean)','EXECUTE'),'internal terminal transition not exposed');
select * from finish(); rollback;
