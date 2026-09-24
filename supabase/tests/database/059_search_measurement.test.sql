begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(31);

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


set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select is(public.get_case_measurement('f2000000-0000-4000-8000-000000000001'), '[]'::jsonb, 'unpaid cases have no purchase event');
select lives_ok($$select public.save_case_acquisition('f2000000-0000-4000-8000-000000000001',jsonb_build_object('utm_source','organic','landing_page','/','captured_at',statement_timestamp()),true)$$,'an owner can attach validated attribution');
select lives_ok($$select public.save_case_acquisition('f2000000-0000-4000-8000-000000000001',jsonb_build_object('gclid','First_click','landing_page','/total-loss-review','captured_at',statement_timestamp()),true)$$,'the first paid source can replace organic');
select lives_ok($$select public.save_case_acquisition('f2000000-0000-4000-8000-000000000001',jsonb_build_object('gclid','Later_click','landing_page','/','captured_at',statement_timestamp()),true)$$,'later clicks do not fail intake');
select throws_ok($$select public.save_case_acquisition('f2000000-0000-4000-8000-000000000001','{"vin":"private"}',true)$$,'22023','Unknown attribution field','private fields are rejected');
select throws_ok($$select public.save_case_acquisition('f2000000-0000-4000-8000-000000000001',jsonb_build_object('gclid',repeat('a',257)),true)$$,'22023','Invalid click identifier','oversized identifiers are rejected');
select throws_ok($$select public.save_case_acquisition('f2000000-0000-4000-8000-000000000001','{"gclid":"<script>"}',true)$$,'22023','Invalid click identifier','malformed identifiers are rejected');
select throws_ok($$select public.record_case_measurement('f2000000-0000-4000-8000-000000000001','purchase_completed')$$,'22023','Invalid event','the browser cannot create a purchase event');
select lives_ok($$select public.record_case_measurement('f2000000-0000-4000-8000-000000000001','review_started')$$,'ordinary funnel events are accepted');
select lives_ok($$select public.record_case_measurement('f2000000-0000-4000-8000-000000000001','review_started')$$,'repeated funnel events are harmless');
reset role;
select is((select count(*) from public.case_measurement_events),1::bigint,'funnel events are idempotent per case');
select is((select attribution->>'gclid' from public.case_acquisition),'First_click','first paid touch is immutable');
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


set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select is(jsonb_array_length(public.get_case_measurement('f2000000-0000-4000-8000-000000000001')),1,'a settled ledger entry produces one purchase');
select is(public.get_case_measurement('f2000000-0000-4000-8000-000000000001')->0->>'value','99.0000000000000000','value uses the actual ledger amount, not the advertised price');
select is(public.get_case_measurement('f2000000-0000-4000-8000-000000000001')->0->>'currency','USD','purchase currency is USD');
select is(public.get_case_measurement('f2000000-0000-4000-8000-000000000001')->0->>'transaction_id','f7000000-0000-4000-8000-000000000001','order reference is stable');
select is(public.get_case_measurement('f2000000-0000-4000-8000-000000000001'),public.get_case_measurement('f2000000-0000-4000-8000-000000000001'),'refreshes return the identical event');
select is(public.get_case_measurement('f2000000-0000-4000-8000-000000000001')->0->>'email',null,'email is absent by default');
select is(public.get_case_measurement('f2000000-0000-4000-8000-000000000001',true)->0->>'email','delivery-owner@example.test','explicit enhanced receipt uses the order email');
select ok(not (public.get_case_measurement('f2000000-0000-4000-8000-000000000001')::text ~ '1HGCM82633A004352|Example Insurance|18000|comparables'),'receipt omits private valuation data');
select lives_ok($$select public.save_case_acquisition('f2000000-0000-4000-8000-000000000001',null,false)$$,'consent can be withdrawn after purchase');
select is(public.get_case_measurement('f2000000-0000-4000-8000-000000000001',true)->0->>'email',null,'withdrawal suppresses enhanced data');
select is(public.get_case_measurement('f2000000-0000-4000-8000-000000000001')->0->'attribution','null'::jsonb,'withdrawal removes acquisition association');
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.get_case_measurement('f2000000-0000-4000-8000-000000000001',true)$$,'42501','Case unavailable','other customers cannot read receipts or identity');
select throws_ok($$select public.save_case_acquisition('f2000000-0000-4000-8000-000000000001',null,false)$$,'42501','Case unavailable','other customers cannot overwrite attribution');
reset role;
insert into public.appraisal_cases(id,user_id,service_type,status) values('f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000003','total_loss','draft');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true);
select lives_ok($$select public.save_case_acquisition('f2000000-0000-4000-8000-000000000003',jsonb_build_object('utm_source','google','landing_page','/','captured_at',statement_timestamp()),true)$$,'anonymous owners can preserve acquisition without signing up');
reset role;
select ok(not has_table_privilege('authenticated','public.financial_measurement_events','select') and not has_table_privilege('anon','public.case_acquisition','select'),'financial and attribution tables are not directly exposed');

insert into public.commerce_refund_requests(id,case_id,order_id,payment_transaction_id,client_request_id,provider_livemode,access_policy,reason_code,amount_minor_units,currency)
values('f7200000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001',gen_random_uuid(),false,'retain','NO_SUPPORTED_DISPUTE',9900,'USD');
select is((select count(*) from public.financial_measurement_events where event_name='refund_issued'),0::bigint,'a requested refund is not an issued refund');
insert into public.payment_transactions(id,case_id,order_id,related_transaction_id,payment_provider,transaction_kind,external_object_id,amount_minor_units,currency,provider_occurred_at)
values('f7300000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f7000000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001','stripe','refund','txn_measurement_refund',9900,'USD',statement_timestamp());
select is((select count(*) from public.financial_measurement_events where event_name='refund_issued'),0::bigint,'refund requires a confirmed succeeded state');
update public.commerce_refund_requests set status='succeeded',provider_status='succeeded',external_refund_id='re_measurement',external_balance_transaction_id='txn_measurement_refund',refund_transaction_id='f7300000-0000-4000-8000-000000000001',provider_occurred_at=statement_timestamp(),finished_at=statement_timestamp() where id='f7200000-0000-4000-8000-000000000001';
select is((select count(*) from public.financial_measurement_events where event_name='refund_issued'),1::bigint,'confirmed refund produces one authoritative event');
select is((select count(*) from public.financial_measurement_events where event_name='purchase_completed'),1::bigint,'refund preserves original purchase history');
select * from finish();
rollback;
