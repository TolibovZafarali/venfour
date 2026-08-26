begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(152);

create function pg_temp.has_case_order_attempt_lock_order(
  requested_function regprocedure
)
returns boolean
language sql
as $$
  with function_source as (
    select lower(pg_get_functiondef(requested_function::oid)) as definition
  ), after_case_lock as (
    select substring(
      definition from position('pg_advisory_xact_lock' in definition)
    ) as definition
    from function_source
  )
  select position('pg_advisory_xact_lock' in definition) > 0
    and position('select commerce_order.*' in definition) > 0
    and position('select checkout_attempt.*' in definition) > 0
    and position('select commerce_order.*' in definition)
      < position('select checkout_attempt.*' in definition)
  from after_case_lock;
$$;

select ok(
  to_regclass('public.stripe_webhook_events') is not null
    and to_regclass('public.commerce_refund_requests') is not null
    and to_regclass('public.commerce_disputes') is not null,
  'Stripe webhook, refund-operation, and dispute projections reuse the Milestone 1 commerce foundation'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'commerce_orders'
      and column_name = 'provider_livemode'
  )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'commerce_orders'
        and column_name = 'purchaser_email'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'checkout_attempts'
        and column_name = 'request_chain_id'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'checkout_attempts'
        and column_name = 'attempt_generation'
    ),
  'orders freeze provider mode and verified email while checkout attempts support controlled replacement generations'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'commerce_refund_requests'
      and column_name = 'external_balance_transaction_id'
  )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'commerce_refund_requests'
        and column_name = 'external_failure_balance_transaction_id'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'commerce_refund_requests'
        and column_name = 'refund_transaction_id'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'commerce_refund_requests'
        and column_name = 'refund_reversal_transaction_id'
    ),
  'refund operations preserve immutable Stripe balance and reversal transaction identities'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_class as relation
    where relation.oid = 'public.stripe_webhook_events'::regclass
  )
    and (
      select relation.relrowsecurity
      from pg_class as relation
      where relation.oid = 'public.commerce_refund_requests'::regclass
    )
    and (
      select relation.relrowsecurity
      from pg_class as relation
      where relation.oid = 'public.commerce_disputes'::regclass
    ),
  'all new provider and financial operation tables have RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'public.stripe_webhook_events', 'SELECT')
    and not has_table_privilege('authenticated', 'public.stripe_webhook_events', 'SELECT')
    and not has_table_privilege('authenticated', 'public.commerce_refund_requests', 'SELECT')
    and not has_table_privilege('authenticated', 'public.commerce_disputes', 'SELECT')
    and has_table_privilege('service_role', 'public.stripe_webhook_events', 'SELECT,INSERT,UPDATE'),
  'provider audit, refund, and dispute rows remain server-only'
);

select ok(
  to_regprocedure('public.authorize_total_loss_checkout_preflight(uuid,uuid)') is not null
    and to_regprocedure('public.reserve_total_loss_checkout(uuid,uuid,uuid,text,text,text,bigint,text,text,text,boolean)') is not null
    and to_regprocedure('public.attach_total_loss_checkout_session(uuid,text,text,text,timestamp with time zone,boolean)') is not null
    and to_regprocedure('public.authorize_total_loss_checkout_reconciliation(uuid,uuid,text)') is not null
    and to_regprocedure('public.resolve_total_loss_checkout_context(uuid,uuid)') is not null
    and to_regprocedure('public.resolve_total_loss_checkout_context_by_session_id(text)') is not null
    and to_regprocedure('public.resolve_total_loss_payment_context(text)') is not null
    and to_regprocedure('public.reconcile_total_loss_checkout_attempt(uuid,uuid,text,text,text,text,timestamp with time zone,boolean,text,integer,bigint,text)') is not null
    and to_regprocedure('public.recover_total_loss_checkout_attempt(uuid,uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,boolean,text,integer,bigint,text)') is not null
    and to_regprocedure('public.fail_total_loss_checkout_attempt_from_webhook(uuid,uuid,text,text,uuid,text)') is not null
    and to_regprocedure('public.expire_total_loss_checkout_attempt_from_webhook(uuid,uuid,text,text,uuid,timestamp with time zone)') is not null
    and to_regprocedure('public.fulfill_total_loss_checkout_payment(uuid,uuid,uuid,text,text,text,uuid,text,integer,bigint,text,boolean,timestamp with time zone)') is not null
    and to_regprocedure('public.claim_stripe_webhook_event(text,text,boolean,text,text,integer,timestamp with time zone,uuid)') is not null
    and to_regprocedure('public.finalize_stripe_webhook_event(uuid,uuid,text,uuid,uuid,text)') is not null
    and to_regprocedure('public.reserve_total_loss_refund(uuid,uuid,uuid,uuid,text,text)') is not null
    and to_regprocedure('public.record_total_loss_refund_result(uuid,text,text,text,text,text,timestamp with time zone,text)') is not null
    and to_regprocedure('public.record_total_loss_dispute(uuid,uuid,uuid,text,text,text,text,bigint,text,timestamp with time zone)') is not null,
  'Milestone 3 exposes the exact narrow service RPC surface'
);

select ok(
  (
    select count(*) = 17
      and bool_and(procedure.prosecdef)
      and bool_and('search_path=""' = any(procedure.proconfig))
    from pg_proc as procedure
    where procedure.oid = any (array[
      'public.authorize_total_loss_checkout_preflight(uuid,uuid)'::regprocedure,
      'public.reserve_total_loss_checkout(uuid,uuid,uuid,text,text,text,bigint,text,text,text,boolean)'::regprocedure,
      'public.attach_total_loss_checkout_session(uuid,text,text,text,timestamp with time zone,boolean)'::regprocedure,
      'public.authorize_total_loss_checkout_reconciliation(uuid,uuid,text)'::regprocedure,
      'public.resolve_total_loss_checkout_context(uuid,uuid)'::regprocedure,
      'public.resolve_total_loss_checkout_context_by_session_id(text)'::regprocedure,
      'public.resolve_total_loss_payment_context(text)'::regprocedure,
      'public.reconcile_total_loss_checkout_attempt(uuid,uuid,text,text,text,text,timestamp with time zone,boolean,text,integer,bigint,text)'::regprocedure,
      'public.recover_total_loss_checkout_attempt(uuid,uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,boolean,text,integer,bigint,text)'::regprocedure,
      'public.fail_total_loss_checkout_attempt_from_webhook(uuid,uuid,text,text,uuid,text)'::regprocedure,
      'public.expire_total_loss_checkout_attempt_from_webhook(uuid,uuid,text,text,uuid,timestamp with time zone)'::regprocedure,
      'public.fulfill_total_loss_checkout_payment(uuid,uuid,uuid,text,text,text,uuid,text,integer,bigint,text,boolean,timestamp with time zone)'::regprocedure,
      'public.claim_stripe_webhook_event(text,text,boolean,text,text,integer,timestamp with time zone,uuid)'::regprocedure,
      'public.finalize_stripe_webhook_event(uuid,uuid,text,uuid,uuid,text)'::regprocedure,
      'public.reserve_total_loss_refund(uuid,uuid,uuid,uuid,text,text)'::regprocedure,
      'public.record_total_loss_refund_result(uuid,text,text,text,text,text,timestamp with time zone,text)'::regprocedure,
      'public.record_total_loss_dispute(uuid,uuid,uuid,text,text,text,text,bigint,text,timestamp with time zone)'::regprocedure
    ])
  ),
  'all commerce RPCs are security-definer functions with empty search paths'
);

select ok(
  pg_temp.has_case_order_attempt_lock_order(
    'public.attach_total_loss_checkout_session(uuid,text,text,text,timestamp with time zone,boolean)'::regprocedure
  )
    and pg_temp.has_case_order_attempt_lock_order(
      'public.fail_total_loss_checkout_attempt_from_webhook(uuid,uuid,text,text,uuid,text)'::regprocedure
    )
    and pg_temp.has_case_order_attempt_lock_order(
      'public.expire_total_loss_checkout_attempt_from_webhook(uuid,uuid,text,text,uuid,timestamp with time zone)'::regprocedure
    ),
  'session attachment and signed terminal transitions lock case then order then attempt consistently'
);

select ok(
  position(
    'pg_advisory_xact_lock' in pg_get_functiondef(
      'public.record_total_loss_refund_result(uuid,text,text,text,text,text,timestamp with time zone,text)'::regprocedure
    )
  ) < position(
    'for update of refund_request, commerce_order' in lower(pg_get_functiondef(
      'public.record_total_loss_refund_result(uuid,text,text,text,text,text,timestamp with time zone,text)'::regprocedure
    ))
  ),
  'refund result processing acquires the case advisory lock before mutable refund and order row locks'
);

select ok(
  has_function_privilege('service_role', 'public.reserve_total_loss_checkout(uuid,uuid,uuid,text,text,text,bigint,text,text,text,boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.reserve_total_loss_checkout(uuid,uuid,uuid,text,text,text,bigint,text,text,text,boolean)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.recover_total_loss_checkout_attempt(uuid,uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,boolean,text,integer,bigint,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.recover_total_loss_checkout_attempt(uuid,uuid,uuid,uuid,text,text,text,text,text,timestamp with time zone,boolean,text,integer,bigint,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.resolve_total_loss_checkout_context_by_session_id(text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.resolve_total_loss_checkout_context_by_session_id(text)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.project_total_loss_order_coverage_internal(uuid,timestamp with time zone)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.project_total_loss_order_coverage_internal(uuid,timestamp with time zone)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.fulfill_total_loss_checkout_payment(uuid,uuid,uuid,text,text,text,uuid,text,integer,bigint,text,boolean,timestamp with time zone)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.fulfill_total_loss_checkout_payment(uuid,uuid,uuid,text,text,text,uuid,text,integer,bigint,text,boolean,timestamp with time zone)', 'EXECUTE'),
  'only service_role can execute authoritative commerce mutations'
);

select ok(
  (
    select array_agg(attribute.attname::text order by attribute.attnum)
    from pg_attribute as attribute
    where attribute.attrelid = 'public.total_loss_case_claim_resume_result'::regclass
      and attribute.attnum > 6
      and not attribute.attisdropped
  ) = array[
    'checkout_available',
    'commerce_order_status',
    'payment_status',
    'entitlement_status',
    'next_task'
  ]::text[],
  'claim resume adds only provider-safe commerce projection fields'
);

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values
  ('d1000000-0000-4000-8000-000000000001', 'buyer@example.test', statement_timestamp(), false),
  ('d1000000-0000-4000-8000-000000000002', 'other@example.test', statement_timestamp(), false),
  ('d1000000-0000-4000-8000-000000000003', null, null, true);

create function pg_temp.create_commerce_case(
  requested_case_id uuid,
  requested_owner_id uuid,
  requested_email text
)
returns void
language plpgsql
as $$
declare
  details_input_id uuid := gen_random_uuid();
  analysis_job_id uuid := gen_random_uuid();
  analysis_run_id uuid := gen_random_uuid();
  snapshot_id uuid := gen_random_uuid();
  digest_value text := replace(requested_case_id::text, '-', '')
    || replace(requested_case_id::text, '-', '');
begin
  insert into public.appraisal_cases (id, user_id, service_type, status)
  values (requested_case_id, requested_owner_id, 'total_loss', 'check_complete');

  insert into public.total_loss_case_details (
    case_id, intake_mode, vin, vehicle_year, vehicle_make, vehicle_model,
    vehicle_trim, mileage_at_loss, postal_code, date_of_loss, insurer_name,
    insurer_vehicle_valuation, intake_completed_at, analysis_input_revision,
    analysis_input_id
  ) values (
    requested_case_id, 'manual', '1HGCM82633A004352', 2022, 'Honda',
    'Accord', 'EX-L', 32000, '60601', '2026-08-20', 'Example Insurance',
    18000, statement_timestamp(), 1, details_input_id
  );

  insert into public.total_loss_case_contacts (
    case_id, full_name, email, service_terms_version,
    service_terms_acknowledged_at, privacy_notice_version,
    privacy_notice_acknowledged_at, operational_follow_up_allowed,
    operational_follow_up_updated_at
  ) values (
    requested_case_id, 'Commerce Customer', requested_email, '2026-08-23',
    statement_timestamp(), '2026-08-23', statement_timestamp(), false,
    statement_timestamp()
  );

  insert into public.total_loss_analysis_jobs (
    id, case_id, source_report_upload_id, source_details_updated_at, status,
    attempt_count, processing_token, processing_expires_at, run_id,
    failure_code, retryable, finished_at, source_intake_mode,
    source_analysis_input_revision, source_analysis_input_id
  ) values (
    analysis_job_id, requested_case_id, null, statement_timestamp(),
    'completed', 1, gen_random_uuid(), null, analysis_run_id, null, null,
    statement_timestamp(), 'manual', 1, details_input_id
  );

  insert into public.analysis_runs (
    id, job_id, case_id, artifact, request_digest,
    analysis_run_schema_version, analysis_version,
    discrepancy_analysis_version, comparable_scoring_version
  ) values (
    analysis_run_id, analysis_job_id, requested_case_id,
    jsonb_build_object(
      'runId', analysis_run_id::text,
      'result', jsonb_build_object(
        'discrepancyResult', jsonb_build_object(
          'classification', 'MATERIAL_UNDERVALUE_SIGNAL'
        )
      )
    ), digest_value,
    '4', '4', '1', '1'
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
    snapshot_id, requested_case_id, analysis_job_id, analysis_run_id,
    requested_owner_id, 'manual', null, 1, details_input_id,
    'MATERIAL_UNDERVALUE_SIGNAL', 1800000, 2000000, 2100000, 2200000,
    'USD', '4', '4', '1', '1', '1', '1',
    jsonb_build_object('analysisRun', analysis_run_id::text),
    jsonb_build_object('classification', 'MATERIAL_UNDERVALUE_SIGNAL'),
    digest_value
  );

  insert into public.total_loss_claim_workflows (
    case_id, preliminary_snapshot_id, phase, current_task
  ) values (requested_case_id, snapshot_id, 'review', 'secure_claim');
end;
$$;

select pg_temp.create_commerce_case(
  'd2000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'buyer@example.test'
);
select pg_temp.create_commerce_case(
  'd2000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000001',
  'buyer@example.test'
);
select pg_temp.create_commerce_case(
  'd2000000-0000-4000-8000-000000000003',
  'd1000000-0000-4000-8000-000000000001',
  'buyer@example.test'
);
select pg_temp.create_commerce_case(
  'd2000000-0000-4000-8000-000000000004',
  'd1000000-0000-4000-8000-000000000001',
  'buyer@example.test'
);
select pg_temp.create_commerce_case(
  'd2000000-0000-4000-8000-000000000005',
  'd1000000-0000-4000-8000-000000000003',
  'anonymous@example.test'
);
select pg_temp.create_commerce_case(
  'd2000000-0000-4000-8000-000000000006',
  'd1000000-0000-4000-8000-000000000001',
  'buyer@example.test'
);
select pg_temp.create_commerce_case(
  'd2000000-0000-4000-8000-000000000007',
  'd1000000-0000-4000-8000-000000000001',
  'buyer@example.test'
);
select pg_temp.create_commerce_case(
  'd2000000-0000-4000-8000-000000000008',
  'd1000000-0000-4000-8000-000000000001',
  'buyer@example.test'
);
select pg_temp.create_commerce_case(
  'd2000000-0000-4000-8000-000000000009',
  'd1000000-0000-4000-8000-000000000001',
  'buyer@example.test'
);
select pg_temp.create_commerce_case(
  'd2000000-0000-4000-8000-000000000010',
  'd1000000-0000-4000-8000-000000000001',
  'buyer@example.test'
);
select pg_temp.create_commerce_case(
  'd2000000-0000-4000-8000-000000000011',
  'd1000000-0000-4000-8000-000000000001',
  'buyer@example.test'
);
select pg_temp.create_commerce_case(
  'd2000000-0000-4000-8000-000000000012',
  'd1000000-0000-4000-8000-000000000001',
  'buyer@example.test'
);
select pg_temp.create_commerce_case(
  'd2000000-0000-4000-8000-000000000013',
  'd1000000-0000-4000-8000-000000000001',
  'buyer@example.test'
);
select pg_temp.create_commerce_case(
  'd2000000-0000-4000-8000-000000000014',
  'd1000000-0000-4000-8000-000000000001',
  'buyer@example.test'
);
select pg_temp.create_commerce_case(
  'd2000000-0000-4000-8000-000000000015',
  'd1000000-0000-4000-8000-000000000001',
  'buyer@example.test'
);

set local role service_role;

select results_eq(
  $$
    select checkout_available, has_pending_order, purchaser_email
    from public.authorize_total_loss_checkout_preflight(
      'd2000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000001'
    )
  $$,
  $$values (true, false, 'buyer@example.test'::text)$$,
  'preflight authorizes the exact permanent verified-email owner before provider lookup'
);

select is(
  (
    select count(*)
    from public.authorize_total_loss_checkout_preflight(
      'd2000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000002'
    )
  ),
  0::bigint,
  'preflight denies another permanent user without disclosing the case'
);

select is(
  (
    select count(*)
    from public.authorize_total_loss_checkout_preflight(
      'd2000000-0000-4000-8000-000000000005',
      'd1000000-0000-4000-8000-000000000003'
    )
  ),
  0::bigint,
  'preflight denies an authenticated anonymous owner'
);

create temporary table test_checkout_one on commit drop as
select *
from public.reserve_total_loss_checkout(
  'd2000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
  'terms-1', 'refund-1', false
);

select results_eq(
  $$select state, order_status, attempt_status, attempt_generation,
      amount_minor_units, currency, provider_livemode, purchaser_email
    from test_checkout_one$$,
  $$values ('reserved'::text, 'pending'::text, 'creating'::text, 1,
      9900::bigint, 'USD'::text, false, 'buyer@example.test'::text)$$,
  'reservation freezes the server-resolved commercial contract and first attempt'
);

select results_eq(
  $$
    select state, order_id, checkout_attempt_id, client_request_id
    from public.reserve_total_loss_checkout(
      'd2000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001',
      'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
      'terms-1', 'refund-1', false
    )
  $$,
  $$select 'existing'::text, order_id, checkout_attempt_id, client_request_id
    from test_checkout_one$$,
  'the same client request reuses its logical order and active attempt'
);

select results_eq(
  $$
    select state, order_id, checkout_attempt_id
    from public.reserve_total_loss_checkout(
      'd2000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000002',
      'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
      'terms-1', 'refund-1', false
    )
  $$,
  $$select 'existing'::text, order_id, checkout_attempt_id from test_checkout_one$$,
  'two browser tabs cannot reserve independent active Checkout Sessions'
);

select results_eq(
  $$select count(*), (select count(*) from public.checkout_attempts
      where case_id = 'd2000000-0000-4000-8000-000000000001')
    from public.commerce_orders
    where case_id = 'd2000000-0000-4000-8000-000000000001'$$,
  $$values (1::bigint, 1::bigint)$$,
  'duplicate requests create one logical order and one attempt'
);

select throws_ok(
  $$
    select public.reserve_total_loss_checkout(
      'd2000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000001', gen_random_uuid(),
      'total-loss-package', '1', 'price_test_changed', 10900, 'USD',
      'terms-1', 'refund-1', false
    )
  $$,
  '55000',
  'Existing logical order has a different frozen commercial contract.',
  'a configured Price change cannot rewrite an existing logical order'
);

select throws_ok(
  $$
    select public.reserve_total_loss_checkout(
      'd2000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000001', gen_random_uuid(),
      'total-loss-package', '2', 'price_test_v2', 10900, 'USD',
      'terms-2', 'refund-2', false
    )
  $$,
  '55000',
  'Another logical order already exists for this case and product.',
  'a version change cannot create a second payable order beside a non-void order'
);

select results_eq(
  $$
    select state, attempt_status, external_checkout_session_id
    from public.attach_total_loss_checkout_session(
      (select checkout_attempt_id from test_checkout_one),
      'cs_test_one', null, 'cus_test_one',
      statement_timestamp() + interval '1 hour', false
    )
  $$,
  $$values ('attached'::text, 'open'::text, 'cs_test_one'::text)$$,
  'a reserved attempt accepts exactly one authoritative hosted Checkout Session'
);

select results_eq(
  $$
    select case_id, order_id, checkout_attempt_id, purchaser_email,
      external_checkout_session_id, external_price_identifier,
      amount_minor_units, currency, provider_livemode
    from public.resolve_total_loss_checkout_context_by_session_id('cs_test_one')
  $$,
  $$select 'd2000000-0000-4000-8000-000000000001'::uuid,
      order_id, checkout_attempt_id, 'buyer@example.test'::text,
      'cs_test_one'::text, 'price_test_total_loss_v1'::text,
      9900::bigint, 'USD'::text, false
    from test_checkout_one$$,
  'metadata-loss lookup resolves one exact locally bound Session using only frozen commerce context'
);

select is(
  (
    select count(*)
    from public.resolve_total_loss_checkout_context_by_session_id(
      'not_a_stripe_session'
    )
  ),
  0::bigint,
  'metadata-loss lookup returns no disclosure for an invalid or unknown Session identity'
);

select is(
  (
    select count(*)
    from public.authorize_total_loss_checkout_reconciliation(
      'd2000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000002',
      'cs_test_one'
    )
  ),
  0::bigint,
  'wrong-user reconciliation is owner-safe before provider retrieval'
);

select results_eq(
  $$
    select order_id, checkout_attempt_id, external_price_identifier,
      amount_minor_units, currency, provider_livemode
    from public.authorize_total_loss_checkout_reconciliation(
      'd2000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000001',
      'cs_test_one'
    )
  $$,
  $$select order_id, checkout_attempt_id, 'price_test_total_loss_v1'::text,
      9900::bigint, 'USD'::text, false from test_checkout_one$$,
  'authorized reconciliation returns the frozen local contract before Stripe retrieval'
);

select results_eq(
  $$
    select outcome, order_status, attempt_status, entitlement_status
    from public.reconcile_total_loss_checkout_attempt(
      'd2000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000001', 'cs_test_one',
      'complete', 'paid', 'pi_test_one',
      statement_timestamp() + interval '1 hour', false,
      'price_test_total_loss_v1', 1, 9900, 'USD'
    )
  $$,
  $$values ('observed'::text, 'pending'::text, 'complete'::text, null::text)$$,
  'browser reconciliation observes provider payment but never grants entitlement'
);

select results_eq(
  $$
    select state, order_id, checkout_attempt_id, attempt_status
    from public.reserve_total_loss_checkout(
      'd2000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000009',
      'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
      'terms-1', 'refund-1', false
    )
  $$,
  $$select 'existing'::text, order_id, checkout_attempt_id, 'complete'::text
    from test_checkout_one$$,
  'a completed paid observation awaiting webhook authority blocks every replacement request'
);

select results_eq(
  $$
    select checkout_available, has_pending_order
    from public.authorize_total_loss_checkout_preflight(
      'd2000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000001'
    )
  $$,
  $$values (false, true)$$,
  'preflight projects payment pending instead of allowing a second Checkout while fulfillment awaits its webhook'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-4000-8000-000000000001';

select results_eq(
  $$
    select checkout_available, commerce_order_status, payment_status,
      entitlement_status
    from public.resolve_total_loss_case_claim(
      'd2000000-0000-4000-8000-000000000001'
    )
  $$,
  $$values (false, 'pending'::text, 'pending'::text, null::text)$$,
  'the customer-safe claim projection reports payment pending while webhook fulfillment is outstanding'
);

reset role;
set local role service_role;

select throws_ok(
  $$
    update public.checkout_attempts
    set external_customer_id = 'cus_tampered'
    where id = (select checkout_attempt_id from test_checkout_one)
  $$,
  '55000',
  'Terminal Checkout attempt is immutable.',
  'service-role table access cannot rewrite provider identity on a terminal Checkout attempt'
);

select ok(
  not exists (
    select 1 from public.payment_transactions
    where case_id = 'd2000000-0000-4000-8000-000000000001'
  )
    and not exists (
      select 1 from public.case_entitlements
      where case_id = 'd2000000-0000-4000-8000-000000000001'
    ),
  'a successful browser return alone creates no payment authority or access'
);

create temporary table test_event_one on commit drop as
select *
from public.claim_stripe_webhook_event(
  'evt_checkout_one', 'checkout.session.completed', false, '2025-08-27.basil',
  repeat('a', 64), 1024, statement_timestamp() - interval '1 second',
  'd4000000-0000-4000-8000-000000000001'
);

select results_eq(
  $$select state, status, attempt_count, processing_token
    from test_event_one$$,
  $$values ('claimed'::text, 'processing'::text, 1,
    'd4000000-0000-4000-8000-000000000001'::uuid)$$,
  'the first signature-verified event reserves one processing lease'
);

select results_eq(
  $$
    select state, status, attempt_count, processing_token
    from public.claim_stripe_webhook_event(
      'evt_checkout_one', 'checkout.session.completed', false,
      '2025-08-27.basil', repeat('a', 64), 1024,
      (select provider_created_at from public.stripe_webhook_events
        where external_event_id = 'evt_checkout_one'),
      'd4000000-0000-4000-8000-000000000001'
    )
  $$,
  $$values ('claimed'::text, 'processing'::text, 1,
    'd4000000-0000-4000-8000-000000000001'::uuid)$$,
  'an ambiguous claim retry with the same fencing token idempotently resumes its lease'
);

select results_eq(
  $$
    select state, status, attempt_count, processing_token
    from public.claim_stripe_webhook_event(
      'evt_checkout_one', 'checkout.session.completed', false,
      '2025-08-27.basil', repeat('a', 64), 1024,
      (select provider_created_at from public.stripe_webhook_events
        where external_event_id = 'evt_checkout_one'),
      'd4000000-0000-4000-8000-000000000002'
    )
  $$,
  $$values ('in_progress'::text, 'processing'::text, 1, null::uuid)$$,
  'a concurrent duplicate event cannot take over an active processing lease'
);

select throws_ok(
  $$
    select public.claim_stripe_webhook_event(
      'evt_checkout_one', 'checkout.session.completed', false,
      '2025-08-27.basil', repeat('b', 64), 1024,
      (select provider_created_at from public.stripe_webhook_events
        where external_event_id = 'evt_checkout_one'), gen_random_uuid()
    )
  $$,
  '55000',
  'Stripe event ID was reused with different signed content.',
  'event-ID reuse with a different raw-body digest is rejected'
);

select throws_ok(
  $$
    select public.fulfill_total_loss_checkout_payment(
      'd2000000-0000-4000-8000-000000000001',
      (select order_id from test_checkout_one),
      (select checkout_attempt_id from test_checkout_one),
      'cs_test_one', 'pi_test_one', 'evt_checkout_one',
      'd4000000-0000-4000-8000-000000000001',
      'price_wrong', 1, 9900, 'USD', false,
      statement_timestamp() - interval '1 second'
    )
  $$,
  '22023',
  'Stripe payment does not match the frozen order and attempt.',
  'webhook fulfillment rejects a Price mismatch against the frozen order'
);

select results_eq(
  $$
    select outcome, order_status, entitlement_status
    from public.fulfill_total_loss_checkout_payment(
      'd2000000-0000-4000-8000-000000000001',
      (select order_id from test_checkout_one),
      (select checkout_attempt_id from test_checkout_one),
      'cs_test_one', 'pi_test_one', 'evt_checkout_one',
      'd4000000-0000-4000-8000-000000000001',
      'price_test_total_loss_v1', 1, 9900, 'USD', false,
      statement_timestamp() - interval '1 second'
    )
  $$,
  $$values ('fulfilled'::text, 'paid'::text, 'active'::text)$$,
  'a claimed supported checkout webhook atomically fulfills one purchase'
);

select results_eq(
  $$
    select
      (select count(*) from public.payment_transactions
        where case_id = 'd2000000-0000-4000-8000-000000000001'
          and transaction_kind = 'payment'),
      (select count(*) from public.case_entitlements
        where case_id = 'd2000000-0000-4000-8000-000000000001'),
      (select count(*) from public.total_loss_package_jobs
        where case_id = 'd2000000-0000-4000-8000-000000000001'),
      (select current_task from public.total_loss_claim_workflows
        where case_id = 'd2000000-0000-4000-8000-000000000001'),
      (select status::text from public.appraisal_cases
        where id = 'd2000000-0000-4000-8000-000000000001')
  $$,
  $$values (1::bigint, 1::bigint, 0::bigint, 'purchase_complete'::text,
    'check_complete'::text)$$,
  'fulfillment records one payment and entitlement without starting package work or changing appraisal status'
);

select results_eq(
  $$
    select status, attempt_count
    from public.finalize_stripe_webhook_event(
      (select webhook_event_id from test_event_one),
      'd4000000-0000-4000-8000-000000000001',
      'processed', 'd2000000-0000-4000-8000-000000000001',
      (select order_id from test_checkout_one), null
    )
  $$,
  $$values ('processed'::text, 1)$$,
  'processed webhook audit is bound to its case and logical order'
);

select results_eq(
  $$
    select state, status
    from public.claim_stripe_webhook_event(
      'evt_checkout_one', 'checkout.session.completed', false,
      '2025-08-27.basil', repeat('a', 64), 1024,
      (select provider_created_at from public.stripe_webhook_events
        where external_event_id = 'evt_checkout_one'), gen_random_uuid()
    )
  $$,
  $$values ('processed'::text, 'processed'::text)$$,
  'a duplicate delivered event is acknowledged without reprocessing'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-4000-8000-000000000001';

select results_eq(
  $$
    select state, checkout_available, commerce_order_status, payment_status,
      entitlement_status, next_task
    from public.resolve_total_loss_case_claim(
      'd2000000-0000-4000-8000-000000000001'
    )
  $$,
  $$values ('secured'::text, false, 'paid'::text, 'succeeded'::text,
    'active'::text, 'purchase_complete'::text)$$,
  'secured owners receive only the safe authoritative paid projection'
);

select throws_ok(
  $$update public.payment_transactions set amount_minor_units = 1
    where external_object_id = 'pi_test_one'$$,
  '42501',
  null,
  'browser roles cannot mutate immutable financial transactions'
);

reset role;
set local role service_role;

select throws_ok(
  $$update public.payment_transactions set amount_minor_units = 1
    where external_object_id = 'pi_test_one'$$,
  '42501',
  null,
  'service-role API grants do not permit financial-record updates after insertion'
);

create temporary table test_checkout_two on commit drop as
select *
from public.reserve_total_loss_checkout(
  'd2000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000020',
  'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
  'terms-1', 'refund-1', false
);

select * from public.attach_total_loss_checkout_session(
  (select checkout_attempt_id from test_checkout_two), 'cs_test_two_old',
  null, null, statement_timestamp() + interval '1 hour', false
);

select * from public.reconcile_total_loss_checkout_attempt(
  'd2000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000001', 'cs_test_two_old',
  'expired', 'unpaid', null, statement_timestamp() - interval '1 second',
  false, 'price_test_total_loss_v1', 1, 9900, 'USD'
);

select results_eq(
  $$
    select outcome, order_status, attempt_status, entitlement_status
    from public.reconcile_total_loss_checkout_attempt(
      'd2000000-0000-4000-8000-000000000002',
      'd1000000-0000-4000-8000-000000000001', 'cs_test_two_old',
      'open', 'unpaid', null, statement_timestamp() + interval '1 hour',
      false, 'price_test_total_loss_v1', 1, 9900, 'USD'
    )
  $$,
  $$values ('already_terminal'::text, 'pending'::text, 'expired'::text,
    null::text)$$,
  'a stale browser observation cannot reopen an expired Checkout attempt'
);

create temporary table test_checkout_two_replacement on commit drop as
select *
from public.reserve_total_loss_checkout(
  'd2000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000020',
  'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
  'terms-1', 'refund-1', false
);

select results_eq(
  $$select state, attempt_generation, attempt_status, client_request_id
    from test_checkout_two_replacement$$,
  $$values ('reserved'::text, 2, 'creating'::text,
    'd3000000-0000-4000-8000-000000000020'::uuid)$$,
  'an expired Session receives a controlled second-generation local attempt for the same client request'
);

select results_eq(
  $$
    select count(*), count(*) filter (where status in ('creating', 'open'))
    from public.checkout_attempts
    where order_id = (select order_id from test_checkout_two)
  $$,
  $$values (2::bigint, 1::bigint)$$,
  'replacement retains history while allowing exactly one active attempt'
);

create temporary table test_checkout_three on commit drop as
select *
from public.reserve_total_loss_checkout(
  'd2000000-0000-4000-8000-000000000003',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000030',
  'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
  'terms-1', 'refund-1', false
);

select * from public.attach_total_loss_checkout_session(
  (select checkout_attempt_id from test_checkout_three), 'cs_test_three',
  null, null, statement_timestamp() + interval '1 hour', false
);

create temporary table test_event_async_failed on commit drop as
select * from public.claim_stripe_webhook_event(
  'evt_async_failed_three', 'checkout.session.async_payment_failed', false,
  null, repeat('3', 64), 900, statement_timestamp() - interval '1 second',
  'd4000000-0000-4000-8000-000000000030'
);

select results_eq(
  $$
    select outcome, order_status, attempt_status, entitlement_status
    from public.fail_total_loss_checkout_attempt_from_webhook(
      (select order_id from test_checkout_three),
      (select checkout_attempt_id from test_checkout_three),
      'cs_test_three', 'evt_async_failed_three',
      'd4000000-0000-4000-8000-000000000030',
      'STRIPE_ASYNC_PAYMENT_FAILED'
    )
  $$,
  $$values ('applied'::text, 'pending'::text, 'failed'::text, null::text)$$,
  'a claimed asynchronous failure terminates the attempt without granting access'
);

select results_eq(
  $$
    select outcome, order_status, attempt_status, entitlement_status
    from public.reconcile_total_loss_checkout_attempt(
      'd2000000-0000-4000-8000-000000000003',
      'd1000000-0000-4000-8000-000000000001', 'cs_test_three',
      'complete', 'unpaid', null, statement_timestamp() + interval '1 hour',
      false, 'price_test_total_loss_v1', 1, 9900, 'USD'
    )
  $$,
  $$values ('already_terminal'::text, 'pending'::text, 'failed'::text,
    null::text)$$,
  'a stale completed observation cannot reopen an asynchronously failed Checkout attempt'
);

select results_eq(
  $$
    select state, attempt_generation, attempt_status
    from public.reserve_total_loss_checkout(
      'd2000000-0000-4000-8000-000000000003',
      'd1000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000030',
      'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
      'terms-1', 'refund-1', false
    )
  $$,
  $$values ('reserved'::text, 2, 'creating'::text)$$,
  'retry after an authoritative async failure creates one controlled replacement generation'
);

create temporary table test_checkout_eight on commit drop as
select *
from public.reserve_total_loss_checkout(
  'd2000000-0000-4000-8000-000000000008',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000080',
  'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
  'terms-1', 'refund-1', false
);

create temporary table test_event_expired_eight on commit drop as
select *
from public.claim_stripe_webhook_event(
  'evt_expired_eight', 'checkout.session.expired', false, null,
  repeat('8', 64), 800, statement_timestamp() - interval '1 second',
  'd4000000-0000-4000-8000-000000000080'
);

select results_eq(
  $$
    select outcome, order_status, attempt_status, entitlement_status
    from public.expire_total_loss_checkout_attempt_from_webhook(
      (select order_id from test_checkout_eight),
      (select checkout_attempt_id from test_checkout_eight),
      'cs_test_eight', 'evt_expired_eight',
      'd4000000-0000-4000-8000-000000000080',
      statement_timestamp() - interval '1 second'
    )
  $$,
  $$values ('applied'::text, 'pending'::text, 'expired'::text, null::text)$$,
  'a claimed expiration closes the creating attempt when the provider callback won the attachment race'
);

select results_eq(
  $$
    select state, attempt_generation, attempt_status
    from public.reserve_total_loss_checkout(
      'd2000000-0000-4000-8000-000000000008',
      'd1000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000080',
      'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
      'terms-1', 'refund-1', false
    )
  $$,
  $$values ('reserved'::text, 2, 'creating'::text)$$,
  'a signed crash-window expiration enables one controlled replacement generation'
);

select results_eq(
  $$
    select outcome, order_status, attempt_status, entitlement_status
    from public.recover_total_loss_checkout_attempt(
      'd2000000-0000-4000-8000-000000000008',
      (select order_id from test_checkout_eight),
      (select id from public.checkout_attempts
        where order_id = (select order_id from test_checkout_eight)
          and attempt_generation = 2),
      'd1000000-0000-4000-8000-000000000001',
      'cs_test_eight_complete_unpaid', null, null,
      'complete', 'unpaid', statement_timestamp() - interval '1 minute',
      false, 'price_test_total_loss_v1', 1, 9900, 'USD'
    )
  $$,
  $$values ('applied'::text, 'pending'::text, 'open'::text, null::text)$$,
  'complete-unpaid idempotency recovery binds the original generation as payment-pending without access'
);

select results_eq(
  $$
    select state, attempt_generation, attempt_status,
      (select count(*) from public.checkout_attempts
        where order_id = checkout.order_id)
    from public.reserve_total_loss_checkout(
      'd2000000-0000-4000-8000-000000000008',
      'd1000000-0000-4000-8000-000000000001', gen_random_uuid(),
      'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
      'terms-1', 'refund-1', false
    ) as checkout
  $$,
  $$values ('existing'::text, 2, 'open'::text, 2::bigint)$$,
  'complete-unpaid recovery cannot create a replacement even when the provider expiry is locally past'
);

create temporary table test_checkout_thirteen on commit drop as
select * from public.reserve_total_loss_checkout(
  'd2000000-0000-4000-8000-000000000013',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000130',
  'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
  'terms-1', 'refund-1', false
);

select throws_ok(
  $$
    select public.recover_total_loss_checkout_attempt(
      'd2000000-0000-4000-8000-000000000013',
      (select order_id from test_checkout_thirteen),
      (select checkout_attempt_id from test_checkout_thirteen),
      'd1000000-0000-4000-8000-000000000002',
      'cs_test_thirteen_expired', null, 'cus_test_thirteen',
      'expired', 'unpaid',
      statement_timestamp() - interval '1 minute', false,
      'price_test_total_loss_v1', 1, 9900, 'USD'
    )
  $$,
  '42501',
  'Checkout attempt is not available for this case owner.',
  'expired-Session crash recovery rejects a different purchaser before binding provider identity'
);

create temporary table test_checkout_thirteen_recovered on commit drop as
select * from public.recover_total_loss_checkout_attempt(
  'd2000000-0000-4000-8000-000000000013',
  (select order_id from test_checkout_thirteen),
  (select checkout_attempt_id from test_checkout_thirteen),
  'd1000000-0000-4000-8000-000000000001',
  'cs_test_thirteen_expired', null, 'cus_test_thirteen',
  'expired', 'unpaid',
  statement_timestamp() - interval '1 minute', false,
  'price_test_total_loss_v1', 1, 9900, 'USD'
);

select results_eq(
  $$select outcome, order_status, attempt_status, entitlement_status
    from test_checkout_thirteen_recovered$$,
  $$values ('applied'::text, 'pending'::text, 'expired'::text, null::text)$$,
  'service recovery atomically binds an idempotently returned expired Session and closes the creating attempt'
);

select results_eq(
  $$
    select outcome, order_status, attempt_status, entitlement_status
    from public.recover_total_loss_checkout_attempt(
      'd2000000-0000-4000-8000-000000000013',
      (select order_id from test_checkout_thirteen),
      (select checkout_attempt_id from test_checkout_thirteen),
      'd1000000-0000-4000-8000-000000000001',
      'cs_test_thirteen_expired', null, 'cus_test_thirteen',
      'expired', 'unpaid',
      (select expires_at from public.checkout_attempts
        where id = (select checkout_attempt_id from test_checkout_thirteen)),
      false, 'price_test_total_loss_v1', 1, 9900, 'USD'
    )
  $$,
  $$values ('already_terminal'::text, 'pending'::text, 'expired'::text,
    null::text)$$,
  'exact expired-Session crash recovery replay is idempotent'
);

create temporary table test_checkout_thirteen_replacement on commit drop as
select * from public.reserve_total_loss_checkout(
  'd2000000-0000-4000-8000-000000000013',
  'd1000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000130',
  'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
  'terms-1', 'refund-1', false
);

select results_eq(
  $$select state, attempt_generation, attempt_status,
      (select count(*) from public.checkout_attempts
        where order_id = test_checkout_thirteen_replacement.order_id)
    from test_checkout_thirteen_replacement$$,
  $$values ('reserved'::text, 2, 'creating'::text, 2::bigint)$$,
  'authoritative expired recovery enables exactly one controlled replacement generation'
);

select results_eq(
  $$
    select outcome, order_status, attempt_status, entitlement_status
    from public.recover_total_loss_checkout_attempt(
      'd2000000-0000-4000-8000-000000000013',
      (select order_id from test_checkout_thirteen_replacement),
      (select checkout_attempt_id from test_checkout_thirteen_replacement),
      'd1000000-0000-4000-8000-000000000001',
      'cs_test_thirteen_paid', 'pi_test_thirteen', 'cus_test_thirteen',
      'complete', 'paid', statement_timestamp() + interval '1 hour', false,
      'price_test_total_loss_v1', 1, 9900, 'USD'
    )
  $$,
  $$values ('applied'::text, 'pending'::text, 'complete'::text, null::text)$$,
  'complete-paid idempotency recovery binds the original generation without granting payment authority'
);

select results_eq(
  $$
    select state, checkout_attempt_id, attempt_generation, attempt_status,
      order_status, entitlement_status,
      (select count(*) from public.checkout_attempts
        where order_id = checkout.order_id)
    from public.reserve_total_loss_checkout(
      'd2000000-0000-4000-8000-000000000013',
      'd1000000-0000-4000-8000-000000000001', gen_random_uuid(),
      'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
      'terms-1', 'refund-1', false
    ) as checkout
  $$,
  $$select 'existing'::text, checkout_attempt_id, 2, 'complete'::text,
      'pending'::text, null::text, 2::bigint
    from test_checkout_thirteen_replacement$$,
  'complete-paid recovery remains payment-pending and blocks every replacement before webhook fulfillment'
);

create temporary table test_event_thirteen on commit drop as
select * from public.claim_stripe_webhook_event(
  'evt_checkout_thirteen', 'checkout.session.completed', false, null,
  repeat('d', 64), 700, statement_timestamp() - interval '1 second',
  'd4000000-0000-4000-8000-000000000130'
);

select results_eq(
  $$
    select outcome, order_status, entitlement_status
    from public.fulfill_total_loss_checkout_payment(
      'd2000000-0000-4000-8000-000000000013',
      (select order_id from test_checkout_thirteen_replacement),
      (select checkout_attempt_id from test_checkout_thirteen_replacement),
      'cs_test_thirteen_paid', 'pi_test_thirteen',
      'evt_checkout_thirteen',
      'd4000000-0000-4000-8000-000000000130',
      'price_test_total_loss_v1', 1, 9900, 'USD', false,
      statement_timestamp() - interval '1 second'
    )
  $$,
  $$values ('fulfilled'::text, 'paid'::text, 'active'::text)$$,
  'the later signed webhook fulfills a recovered complete-paid Session exactly once'
);

create function pg_temp.pay_reserved_checkout(
  requested_order_id uuid,
  requested_attempt_id uuid,
  requested_session_id text,
  requested_payment_intent_id text,
  requested_event_id text,
  requested_processing_token uuid
)
returns void
language plpgsql
as $$
declare
  context_row public.total_loss_stripe_context_result;
  claim_row public.stripe_webhook_claim_result;
begin
  select * into context_row
  from public.resolve_total_loss_checkout_context(
    requested_order_id,
    requested_attempt_id
  );

  perform public.attach_total_loss_checkout_session(
    requested_attempt_id,
    requested_session_id,
    null,
    null,
    statement_timestamp() + interval '1 hour',
    context_row.provider_livemode
  );

  select * into claim_row
  from public.claim_stripe_webhook_event(
    requested_event_id,
    'checkout.session.completed',
    context_row.provider_livemode,
    null,
    encode(sha256(convert_to(requested_event_id, 'UTF8')), 'hex'),
    700,
    statement_timestamp() - interval '1 second',
    requested_processing_token
  );

  perform public.fulfill_total_loss_checkout_payment(
    context_row.case_id,
    requested_order_id,
    requested_attempt_id,
    requested_session_id,
    requested_payment_intent_id,
    requested_event_id,
    requested_processing_token,
    context_row.external_price_identifier,
    1,
    context_row.amount_minor_units,
    context_row.currency,
    context_row.provider_livemode,
    statement_timestamp() - interval '1 second'
  );

  perform public.finalize_stripe_webhook_event(
    claim_row.webhook_event_id,
    requested_processing_token,
    'processed',
    context_row.case_id,
    requested_order_id,
    null
  );
end;
$$;

create temporary table test_checkout_nine on commit drop as
select * from public.reserve_total_loss_checkout(
  'd2000000-0000-4000-8000-000000000009',
  'd1000000-0000-4000-8000-000000000001', gen_random_uuid(),
  'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
  'terms-1', 'refund-1', false
);

select * from public.attach_total_loss_checkout_session(
  (select checkout_attempt_id from test_checkout_nine),
  'cs_test_nine', null, null, statement_timestamp() + interval '1 hour', false
);

update public.checkout_attempts
set expires_at = statement_timestamp() - interval '1 minute'
where id = (select checkout_attempt_id from test_checkout_nine);

select results_eq(
  $$
    select state, checkout_attempt_id, attempt_generation, attempt_status
    from public.reserve_total_loss_checkout(
      'd2000000-0000-4000-8000-000000000009',
      'd1000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000090',
      'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
      'terms-1', 'refund-1', false
    )
  $$,
  $$select 'existing'::text, checkout_attempt_id, 1, 'open'::text
    from test_checkout_nine$$,
  'a locally elapsed Session expiry remains authoritative Stripe state and cannot create a replacement'
);

reset role;
update auth.users
set email = 'buyer-changed@example.test'
where id = 'd1000000-0000-4000-8000-000000000001';
set local role service_role;

select results_eq(
  $$
    select purchaser_email
    from public.resolve_total_loss_checkout_context(
      (select order_id from test_checkout_nine),
      (select checkout_attempt_id from test_checkout_nine)
    )
  $$,
  $$values ('buyer@example.test'::text)$$,
  'webhook context uses the order-frozen verified email after the Auth email changes'
);

create temporary table test_event_nine on commit drop as
select * from public.claim_stripe_webhook_event(
  'evt_checkout_nine', 'checkout.session.completed', false, null,
  repeat('9', 64), 700, statement_timestamp() - interval '1 second',
  'd4000000-0000-4000-8000-000000000090'
);

select results_eq(
  $$
    select outcome, order_status, entitlement_status
    from public.fulfill_total_loss_checkout_payment(
      'd2000000-0000-4000-8000-000000000009',
      (select order_id from test_checkout_nine),
      (select checkout_attempt_id from test_checkout_nine),
      'cs_test_nine', 'pi_test_nine', 'evt_checkout_nine',
      'd4000000-0000-4000-8000-000000000090',
      'price_test_total_loss_v1', 1, 9900, 'USD', false,
      statement_timestamp() - interval '1 second'
    )
  $$,
  $$values ('fulfilled'::text, 'paid'::text, 'active'::text)$$,
  'a verified webhook fulfills against frozen purchase identity despite later Auth email mutation'
);

select results_eq(
  $$
    select
      (select count(*) from public.checkout_attempts
        where order_id = (select order_id from test_checkout_nine)),
      (select count(*) from public.payment_transactions
        where order_id = (select order_id from test_checkout_nine)
          and transaction_kind = 'payment'),
      (select count(*) from public.case_entitlements
        where order_id = (select order_id from test_checkout_nine))
  $$,
  $$values (1::bigint, 1::bigint, 1::bigint)$$,
  'a delayed paid webhook fulfills the past-local-expiry attempt exactly once without replacement'
);

reset role;
update auth.users
set email = 'buyer@example.test'
where id = 'd1000000-0000-4000-8000-000000000001';
set local role service_role;

create temporary table test_checkout_ten on commit drop as
select * from public.reserve_total_loss_checkout(
  'd2000000-0000-4000-8000-000000000010',
  'd1000000-0000-4000-8000-000000000001', gen_random_uuid(),
  'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
  'terms-1', 'refund-1', false
);

select * from public.attach_total_loss_checkout_session(
  (select checkout_attempt_id from test_checkout_ten),
  'cs_test_ten', null, null, statement_timestamp() + interval '1 hour', false
);

create temporary table test_event_ten on commit drop as
select * from public.claim_stripe_webhook_event(
  'evt_checkout_ten', 'checkout.session.completed', false, null,
  repeat('0', 64), 700, statement_timestamp() - interval '1 second',
  'd4000000-0000-4000-8000-000000000100'
);

update public.total_loss_claim_workflows
set current_task = 'workflow_drift', revision = revision + 1
where case_id = 'd2000000-0000-4000-8000-000000000010';

select throws_ok(
  $$
    select public.fulfill_total_loss_checkout_payment(
      'd2000000-0000-4000-8000-000000000010',
      (select order_id from test_checkout_ten),
      (select checkout_attempt_id from test_checkout_ten),
      'cs_test_ten', 'pi_test_ten', 'evt_checkout_ten',
      'd4000000-0000-4000-8000-000000000100',
      'price_test_total_loss_v1', 1, 9900, 'USD', false,
      statement_timestamp() - interval '1 second'
    )
  $$,
  '55000',
  'Checkout fulfillment workflow boundary is unavailable.',
  'workflow drift rejects first-payment fulfillment before any authority is recorded'
);

select results_eq(
  $$
    select
      (select status::text from public.commerce_orders
        where id = (select order_id from test_checkout_ten)),
      (select status from public.checkout_attempts
        where id = (select checkout_attempt_id from test_checkout_ten)),
      (select count(*) from public.payment_transactions
        where case_id = 'd2000000-0000-4000-8000-000000000010'),
      (select count(*) from public.case_entitlements
        where case_id = 'd2000000-0000-4000-8000-000000000010')
  $$,
  $$values ('pending'::text, 'open'::text, 0::bigint, 0::bigint)$$,
  'rejected drift leaves order, attempt, payment, and entitlement state unchanged'
);

create temporary table test_checkout_eleven on commit drop as
select * from public.reserve_total_loss_checkout(
  'd2000000-0000-4000-8000-000000000011',
  'd1000000-0000-4000-8000-000000000001', gen_random_uuid(),
  'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
  'terms-1', 'refund-1', false
);

reset role;
update public.commerce_orders
set status = 'void'
where id = (select order_id from test_checkout_eleven);
set local role service_role;

select results_eq(
  $$
    select checkout_available, has_pending_order
    from public.authorize_total_loss_checkout_preflight(
      'd2000000-0000-4000-8000-000000000011',
      'd1000000-0000-4000-8000-000000000001'
    )
  $$,
  $$values (false, false)$$,
  'preflight treats a void logical order as conservatively unavailable'
);

select results_eq(
  $$
    select state, order_status
    from public.reserve_total_loss_checkout(
      'd2000000-0000-4000-8000-000000000011',
      'd1000000-0000-4000-8000-000000000001', gen_random_uuid(),
      'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
      'terms-1', 'refund-1', false
    )
  $$,
  $$values ('unavailable'::text, 'void'::text)$$,
  'reservation agrees that a same-version void order is unavailable'
);

select throws_ok(
  $$
    select public.reserve_total_loss_checkout(
      'd2000000-0000-4000-8000-000000000011',
      'd1000000-0000-4000-8000-000000000001', gen_random_uuid(),
      'total-loss-package', '2', 'price_test_total_loss_v2', 10900, 'USD',
      'terms-2', 'refund-2', false
    )
  $$,
  '55000',
  'Another logical order already exists for this case and product.',
  'a void order cannot silently authorize a new-version purchase'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-4000-8000-000000000001';

select results_eq(
  $$
    select checkout_available, commerce_order_status, payment_status,
      entitlement_status, next_task
    from public.resolve_total_loss_case_claim(
      'd2000000-0000-4000-8000-000000000011'
    )
  $$,
  $$values (false, 'void'::text, null::text, null::text,
    'purchase_unavailable'::text)$$,
  'customer projection exposes a coherent unavailable void state'
);

reset role;
set local role service_role;

select pg_temp.pay_reserved_checkout(
  (select order_id from test_checkout_two_replacement),
  (select checkout_attempt_id from test_checkout_two_replacement),
  'cs_test_two_paid', 'pi_test_two', 'evt_checkout_two',
  'd4000000-0000-4000-8000-000000000020'
);

create temporary table test_event_two_late_expired on commit drop as
select * from public.claim_stripe_webhook_event(
  'evt_checkout_two_late_expired', 'checkout.session.expired', false, null,
  repeat('2', 64), 700, statement_timestamp() - interval '1 second',
  'd4000000-0000-4000-8000-000000000021'
);

select results_eq(
  $$
    select outcome, order_status, attempt_status, entitlement_status
    from public.expire_total_loss_checkout_attempt_from_webhook(
      (select order_id from test_checkout_two),
      (select checkout_attempt_id from test_checkout_two),
      'cs_test_two_old', 'evt_checkout_two_late_expired',
      'd4000000-0000-4000-8000-000000000021',
      (select expires_at from public.checkout_attempts
        where id = (select checkout_attempt_id from test_checkout_two))
    )
  $$,
  $$values ('stale'::text, 'paid'::text, 'expired'::text, 'active'::text)$$,
  'a delayed expiration for an old attempt is acknowledged after its replacement fulfilled the order'
);

create temporary table test_refund_two on commit drop as
select * from public.reserve_total_loss_refund(
  'd2000000-0000-4000-8000-000000000002',
  (select order_id from test_checkout_two_replacement),
  (select id from public.payment_transactions
    where external_object_id = 'pi_test_two'),
  'd5000000-0000-4000-8000-000000000020',
  'CUSTOMER_CANCELLATION', 'revoke'
);

select results_eq(
  $$select state, refund_status, external_payment_intent_id,
      amount_minor_units, access_policy from test_refund_two$$,
  $$values ('reserved'::text, 'creating'::text, 'pi_test_two'::text,
    9900::bigint, 'revoke'::text)$$,
  'refund reservation returns the server-only PaymentIntent and frozen full amount'
);

select results_eq(
  $$
    select outcome, refund_status, provider_status, order_status,
      entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_two),
      're_test_two', 'evt_refund_two_requires_action', null, null,
      'requires_action',
      statement_timestamp() - interval '3 seconds', null
    )
  $$,
  $$values ('pending'::text, 'pending'::text, 'requires_action'::text,
    'paid'::text, 'active'::text)$$,
  'a requires-action refund remains non-final without changing order or access'
);

select results_eq(
  $$
    select outcome, refund_status, provider_status, order_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_two),
      're_test_two', 'evt_refund_two_old_pending', null, null, 'pending',
      statement_timestamp() - interval '4 seconds', null
    )
  $$,
  $$values ('stale'::text, 'pending'::text, 'requires_action'::text,
    'paid'::text)$$,
  'an older pending refund event cannot erase requires-action provider truth'
);

select results_eq(
  $$
    select outcome, refund_status, provider_status, order_status,
      entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_two),
      're_test_two', 'evt_refund_two', 'txn_refund_two', null, 'succeeded',
      statement_timestamp() - interval '1 second', null
    )
  $$,
  $$values ('succeeded'::text, 'succeeded'::text, 'succeeded'::text,
    'refunded'::text, 'revoked'::text)$$,
  'requires-action can resolve to a verified full refund with explicit access revocation'
);

select results_eq(
  $$
    select state, refund_status, order_status, entitlement_status,
      refund_transaction_id is not null,
      refund_reversal_transaction_id is null
    from public.reserve_total_loss_refund(
      'd2000000-0000-4000-8000-000000000002',
      (select order_id from test_checkout_two_replacement),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_two'),
      'd5000000-0000-4000-8000-000000000020',
      'CUSTOMER_CANCELLATION', 'revoke'
    )
  $$,
  $$values ('already_succeeded'::text, 'succeeded'::text, 'refunded'::text,
    'revoked'::text, true, true)$$,
  'an exact successful refund retry returns a complete zero-provider replay projection'
);

select results_eq(
  $$
    select outcome, refund_status, provider_status,
      refund_transaction_id is not null,
      refund_reversal_transaction_id is not null,
      order_status, entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_two),
      're_test_two', 'evt_refund_two_failed', 'txn_refund_two',
      'txn_refund_two_failure', 'failed',
      (select provider_occurred_at from public.commerce_refund_requests
        where id = (select refund_request_id from test_refund_two)),
      'PROVIDER_REVERSED'
    )
  $$,
  $$values ('failed'::text, 'failed'::text, 'failed'::text, true, true,
    'paid'::text, 'active'::text)$$,
  'an equal-second authoritative failed refund records one reversal and restores paid access'
);

select results_eq(
  $$
    select outcome, refund_status, order_status, entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_two),
      're_test_two', 'evt_refund_two_failed', 'txn_refund_two',
      'txn_refund_two_failure', 'failed',
      (select provider_occurred_at from public.commerce_refund_requests
        where id = (select refund_request_id from test_refund_two)),
      'PROVIDER_REVERSED'
    )
  $$,
  $$values ('already_failed'::text, 'failed'::text, 'paid'::text,
    'active'::text)$$,
  'an exact replay of the refund reversal is idempotent'
);

select results_eq(
  $$
    select outcome, refund_status, provider_status, order_status,
      entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_two),
      're_test_two', 'evt_refund_two_reverse_success', 'txn_refund_two', null,
      'succeeded',
      (select provider_occurred_at from public.commerce_refund_requests
        where id = (select refund_request_id from test_refund_two)),
      null
    )
  $$,
  $$values ('stale'::text, 'failed'::text, 'failed'::text, 'paid'::text,
    'active'::text)$$,
  'an equal-second reverse success cannot regress an authoritative refund failure'
);

select results_eq(
  $$
    select
      (select count(*) from public.payment_transactions
        where external_object_id = 'txn_refund_two'),
      (select count(*) from public.payment_transactions
        where external_object_id = 'txn_refund_two_failure'),
      (select reversal.related_transaction_id = refund.id
        from public.payment_transactions as reversal
        join public.payment_transactions as refund
          on refund.external_object_id = 'txn_refund_two'
        where reversal.external_object_id = 'txn_refund_two_failure')
  $$,
  $$values (1::bigint, 1::bigint, true)$$,
  'refund success and provider reversal remain distinct linked immutable movements'
);

select throws_ok(
  $$
    update public.commerce_refund_requests
    set external_failure_balance_transaction_id = 'txn_tampered'
    where id = (select refund_request_id from test_refund_two)
  $$,
  '55000',
  'Refund reversal evidence is immutable.',
  'service table access cannot rewrite recorded refund reversal identity'
);

create temporary table test_refund_two_later on commit drop as
select * from public.reserve_total_loss_refund(
  'd2000000-0000-4000-8000-000000000002',
  (select order_id from test_checkout_two_replacement),
  (select id from public.payment_transactions
    where external_object_id = 'pi_test_two'),
  'd5000000-0000-4000-8000-000000000021',
  'CUSTOMER_CANCELLATION', 'revoke'
);

select results_eq(
  $$
    select outcome, order_status, entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_two_later),
      're_test_two_later', 'evt_refund_two_later',
      'txn_refund_two_later', null, 'succeeded',
      statement_timestamp() - interval '1 second', null
    )
  $$,
  $$values ('succeeded'::text, 'refunded'::text, 'revoked'::text)$$,
  'a later valid refund can succeed after the earlier refund and its reversal are terminal'
);

select results_eq(
  $$
    select outcome, refund_status, provider_status,
      refund_transaction_id is not null,
      refund_reversal_transaction_id is not null,
      order_status, entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_two),
      're_test_two', 'evt_refund_two_failed', 'txn_refund_two',
      'txn_refund_two_failure', 'failed',
      (select provider_occurred_at from public.commerce_refund_requests
        where id = (select refund_request_id from test_refund_two)),
      'PROVIDER_REVERSED'
    )
  $$,
  $$values ('stale'::text, 'failed'::text, 'failed'::text, true, true,
    'refunded'::text, 'revoked'::text)$$,
  'replaying an earlier reversed refund returns its own audit state with the later refund projection'
);

create temporary table test_refund_one on commit drop as
select * from public.reserve_total_loss_refund(
  'd2000000-0000-4000-8000-000000000001',
  (select order_id from test_checkout_one),
  (select id from public.payment_transactions
    where external_object_id = 'pi_test_one'),
  'd5000000-0000-4000-8000-000000000001',
  'FAIR_RESULT', 'retain'
);

select throws_ok(
  $$
    select public.reserve_total_loss_refund(
      'd2000000-0000-4000-8000-000000000001',
      (select order_id from test_checkout_one),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_one'),
      gen_random_uuid(), 'CUSTOMER_CANCELLATION', 'revoke'
    )
  $$,
  '55000',
  'Active refund has different instructions.',
  'a second request cannot silently replace an active refund access policy or reason'
);

select results_eq(
  $$
    select outcome, order_status, entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_one),
      're_test_one', null, 'txn_refund_one', null, 'succeeded',
      statement_timestamp() - interval '1 second', null
    )
  $$,
  $$values ('succeeded'::text, 'refunded'::text,
    'refunded_access_retained'::text)$$,
  'a verified full fair-result refund retains explanatory access explicitly'
);

select results_eq(
  $$
    select outcome, refund_status,
      (select count(*) from public.payment_transactions
        where related_transaction_id = (
          select id from public.payment_transactions
          where external_object_id = 'pi_test_one'
        ) and transaction_kind = 'refund')
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_one),
      're_test_one', null, 'txn_refund_one', null, 'succeeded',
      statement_timestamp(), null
    )
  $$,
  $$values ('already_succeeded'::text, 'succeeded'::text, 1::bigint)$$,
  'successful refund replay cannot create another immutable refund transaction'
);

create temporary table test_checkout_six on commit drop as
select * from public.reserve_total_loss_checkout(
  'd2000000-0000-4000-8000-000000000006',
  'd1000000-0000-4000-8000-000000000001', gen_random_uuid(),
  'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
  'terms-1', 'refund-1', false
);
select pg_temp.pay_reserved_checkout(
  (select order_id from test_checkout_six),
  (select checkout_attempt_id from test_checkout_six),
  'cs_test_six', 'pi_test_six', 'evt_checkout_six',
  'd4000000-0000-4000-8000-000000000060'
);
create temporary table test_refund_failed on commit drop as
select * from public.reserve_total_loss_refund(
  'd2000000-0000-4000-8000-000000000006',
  (select order_id from test_checkout_six),
  (select id from public.payment_transactions
    where external_object_id = 'pi_test_six'), gen_random_uuid(),
  'CUSTOMER_CANCELLATION', 'revoke'
);

select results_eq(
  $$
    select outcome, refund_status, order_status, entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_failed),
      're_test_failed', 'evt_refund_failed', null, null, 'failed',
      statement_timestamp() - interval '1 second', 'PROVIDER_DECLINED'
    )
  $$,
  $$values ('failed'::text, 'failed'::text, 'paid'::text, 'active'::text)$$,
  'a provider-failed refund does not alter paid order or entitlement authority'
);

select results_eq(
  $$
    select outcome, refund_status, order_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_failed),
      're_test_failed', null, null, null, 'pending',
      (select provider_occurred_at - interval '1 second'
        from public.commerce_refund_requests
        where id = (select refund_request_id from test_refund_failed)), null
    )
  $$,
  $$values ('stale'::text, 'failed'::text, 'paid'::text)$$,
  'an older pending refund event is acknowledged without regressing terminal failure'
);

select pg_temp.pay_reserved_checkout(
  (select id from public.commerce_orders
    where case_id = 'd2000000-0000-4000-8000-000000000003'),
  (select id from public.checkout_attempts
    where case_id = 'd2000000-0000-4000-8000-000000000003'
      and attempt_generation = 2),
  'cs_test_three_paid', 'pi_test_three_primary', 'evt_checkout_three_paid',
  'd4000000-0000-4000-8000-000000000031'
);

create temporary table test_refund_three_recovery on commit drop as
select * from public.reserve_total_loss_refund(
  'd2000000-0000-4000-8000-000000000003',
  (select id from public.commerce_orders
    where case_id = 'd2000000-0000-4000-8000-000000000003'),
  (select id from public.payment_transactions
    where external_object_id = 'pi_test_three_primary'),
  'd5000000-0000-4000-8000-000000000030',
  'CUSTOMER_CANCELLATION', 'retain'
);

create temporary table test_event_three_late_failed on commit drop as
select * from public.claim_stripe_webhook_event(
  'evt_checkout_three_late_failed',
  'checkout.session.async_payment_failed', false, null,
  repeat('3', 64), 700, statement_timestamp() - interval '1 second',
  'd4000000-0000-4000-8000-000000000034'
);

select results_eq(
  $$
    select outcome, order_status, attempt_status, entitlement_status
    from public.fail_total_loss_checkout_attempt_from_webhook(
      (select order_id from test_checkout_three),
      (select checkout_attempt_id from test_checkout_three),
      'cs_test_three', 'evt_checkout_three_late_failed',
      'd4000000-0000-4000-8000-000000000034',
      'STRIPE_ASYNC_PAYMENT_FAILED'
    )
  $$,
  $$values ('stale'::text, 'paid'::text, 'failed'::text, 'active'::text)$$,
  'a delayed asynchronous failure for an old attempt is acknowledged after its replacement fulfilled the order'
);

insert into public.checkout_attempts (
  case_id, order_id, client_request_id, request_chain_id, attempt_generation,
  payment_provider, provider_livemode, status, amount_minor_units, currency
)
select
  case_id, id, 'd3000000-0000-4000-8000-000000000031',
  'd3000000-0000-4000-8000-000000000031', 1, 'stripe', false,
  'creating', amount_minor_units, currency
from public.commerce_orders
where case_id = 'd2000000-0000-4000-8000-000000000003';

create temporary table test_duplicate_event on commit drop as
select * from public.claim_stripe_webhook_event(
  'evt_checkout_three_duplicate', 'checkout.session.completed', false, null,
  repeat('c', 64), 800, statement_timestamp() - interval '1 second',
  'd4000000-0000-4000-8000-000000000032'
);

select results_eq(
  $$
    select outcome, order_status, entitlement_status
    from public.fulfill_total_loss_checkout_payment(
      'd2000000-0000-4000-8000-000000000003',
      (select id from public.commerce_orders
        where case_id = 'd2000000-0000-4000-8000-000000000003'),
      (select id from public.checkout_attempts
        where case_id = 'd2000000-0000-4000-8000-000000000003'
          and request_chain_id = 'd3000000-0000-4000-8000-000000000031'),
      'cs_test_three_duplicate', 'pi_test_three_duplicate',
      'evt_checkout_three_duplicate',
      'd4000000-0000-4000-8000-000000000032',
      'price_test_total_loss_v1', 1, 9900, 'USD', false,
      statement_timestamp() - interval '1 second'
    )
  $$,
  $$values ('duplicate_payment'::text, 'paid'::text, 'active'::text)$$,
  'an accidental second successful PaymentIntent is recorded but cannot grant another entitlement'
);

select results_eq(
  $$
    select state, refund_status, external_refund_id, order_status,
      entitlement_status
    from public.reserve_total_loss_refund(
      'd2000000-0000-4000-8000-000000000003',
      (select id from public.commerce_orders
        where case_id = 'd2000000-0000-4000-8000-000000000003'),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_three_primary'),
      'd5000000-0000-4000-8000-000000000030',
      'CUSTOMER_CANCELLATION', 'retain'
    )
  $$,
  $$values ('reserved'::text, 'creating'::text, null::text, 'paid'::text,
    'active'::text)$$,
  'an exact creating refund crash-retry remains provider-retriable after later duplicate-payment evidence'
);

select results_eq(
  $$
    select
      (select count(*) from public.payment_transactions
        where case_id = 'd2000000-0000-4000-8000-000000000003'
          and transaction_kind = 'payment'),
      (select count(*) from public.case_entitlements
        where case_id = 'd2000000-0000-4000-8000-000000000003')
  $$,
  $$values (2::bigint, 1::bigint)$$,
  'duplicate-payment evidence is durable while entitlement remains unique'
);

select * from public.finalize_stripe_webhook_event(
  (select webhook_event_id from test_duplicate_event),
  'd4000000-0000-4000-8000-000000000032', 'failed',
  'd2000000-0000-4000-8000-000000000003',
  (select id from public.commerce_orders
    where case_id = 'd2000000-0000-4000-8000-000000000003'),
  'DUPLICATE_PAYMENT'
);

create temporary table test_duplicate_retry on commit drop as
select * from public.claim_stripe_webhook_event(
  'evt_checkout_three_duplicate', 'checkout.session.completed', false, null,
  repeat('c', 64), 800,
  (select provider_created_at from public.stripe_webhook_events
    where external_event_id = 'evt_checkout_three_duplicate'),
  'd4000000-0000-4000-8000-000000000033'
);

select results_eq(
  $$
    select outcome
    from public.fulfill_total_loss_checkout_payment(
      'd2000000-0000-4000-8000-000000000003',
      (select id from public.commerce_orders
        where case_id = 'd2000000-0000-4000-8000-000000000003'),
      (select id from public.checkout_attempts
        where external_payment_intent_id = 'pi_test_three_duplicate'),
      'cs_test_three_duplicate', 'pi_test_three_duplicate',
      'evt_checkout_three_duplicate',
      'd4000000-0000-4000-8000-000000000033',
      'price_test_total_loss_v1', 1, 9900, 'USD', false,
      statement_timestamp() - interval '1 second'
    )
  $$,
  $$values ('duplicate_payment'::text)$$,
  'duplicate-payment retry remains an operational exception rather than becoming already fulfilled'
);

create temporary table test_case_three_clean_projection on commit drop as
select
  to_jsonb(commerce_order) as order_row,
  to_jsonb(entitlement) as entitlement_row
from public.commerce_orders as commerce_order
join public.case_entitlements as entitlement
  on entitlement.order_id = commerce_order.id
where commerce_order.case_id = 'd2000000-0000-4000-8000-000000000003';

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000003',
      (select id from public.commerce_orders
        where case_id = 'd2000000-0000-4000-8000-000000000003'),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_three_primary'),
      'dp_test_three_primary', 'evt_dp_three_primary_active',
      'charge.dispute.created', 'active', 9900, 'USD',
      statement_timestamp() - interval '8 seconds'
    )
  $$,
  $$values ('applied'::text, 'active'::text, 'paid'::text, 'active'::text)$$,
  'an active dispute on one payment leaves paid access covered by another clean payment'
);

select results_eq(
  $$
    select
      (select to_jsonb(commerce_order)
        from public.commerce_orders as commerce_order
        where commerce_order.case_id = 'd2000000-0000-4000-8000-000000000003')
        = (select order_row from test_case_three_clean_projection),
      (select to_jsonb(entitlement)
        from public.case_entitlements as entitlement
        where entitlement.case_id = 'd2000000-0000-4000-8000-000000000003')
        = (select entitlement_row from test_case_three_clean_projection)
  $$,
  $$values (true, true)$$,
  'clean duplicate-payment coverage preserves every order and entitlement field and timestamp'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000003',
      (select id from public.commerce_orders
        where case_id = 'd2000000-0000-4000-8000-000000000003'),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_three_primary'),
      'dp_test_three_primary', 'evt_dp_three_primary_lost',
      'charge.dispute.closed', 'lost', 9900, 'USD',
      statement_timestamp() - interval '7 seconds'
    )
  $$,
  $$values ('applied'::text, 'lost'::text, 'paid'::text, 'active'::text)$$,
  'a lost dispute on one payment still leaves access covered by another clean payment'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000003',
      (select id from public.commerce_orders
        where case_id = 'd2000000-0000-4000-8000-000000000003'),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_three_primary'),
      'dp_test_three_primary', 'evt_dp_three_primary_won',
      'charge.dispute.closed', 'won', 9900, 'USD',
      statement_timestamp() - interval '6 seconds'
    )
  $$,
  $$values ('applied'::text, 'won'::text, 'paid'::text, 'active'::text)$$,
  'a newer late win keeps both successful payments clean and access active'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000003',
      (select id from public.commerce_orders
        where case_id = 'd2000000-0000-4000-8000-000000000003'),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_three_duplicate'),
      'dp_test_three_duplicate', 'evt_dp_three_duplicate_active',
      'charge.dispute.created', 'active', 9900, 'USD',
      statement_timestamp() - interval '5 seconds'
    )
  $$,
  $$values ('applied'::text, 'active'::text, 'paid'::text, 'active'::text)$$,
  'the other payment can also become adverse while the primary clean payment preserves access'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000003',
      (select id from public.commerce_orders
        where case_id = 'd2000000-0000-4000-8000-000000000003'),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_three_primary'),
      'dp_test_three_primary_second', 'evt_dp_three_primary_second_active',
      'charge.dispute.created', 'active', 9900, 'USD',
      statement_timestamp() - interval '4 seconds'
    )
  $$,
  $$values ('applied'::text, 'active'::text, 'disputed'::text, 'suspended'::text)$$,
  'adverse disputes across both payments suspend access when no clean coverage remains'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000003',
      (select id from public.commerce_orders
        where case_id = 'd2000000-0000-4000-8000-000000000003'),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_three_duplicate'),
      'dp_test_three_duplicate', 'evt_dp_three_duplicate_won',
      'charge.dispute.closed', 'won', 9900, 'USD',
      statement_timestamp() - interval '3 seconds'
    )
  $$,
  $$values ('applied'::text, 'won'::text, 'paid'::text, 'active'::text)$$,
  'winning either dispute restores clean aggregate payment coverage and active access'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000003',
      (select id from public.commerce_orders
        where case_id = 'd2000000-0000-4000-8000-000000000003'),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_three_primary'),
      'dp_test_three_primary_second', 'evt_dp_three_primary_second_lost',
      'charge.dispute.closed', 'lost', 9900, 'USD',
      statement_timestamp() - interval '2 seconds'
    )
  $$,
  $$values ('applied'::text, 'lost'::text, 'paid'::text, 'active'::text)$$,
  'a remaining lost dispute cannot suspend access while the duplicate payment is clean'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000003',
      (select id from public.commerce_orders
        where case_id = 'd2000000-0000-4000-8000-000000000003'),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_three_primary'),
      'dp_test_three_primary_second', 'evt_dp_three_primary_second_won',
      'charge.dispute.closed', 'won', 9900, 'USD',
      statement_timestamp() - interval '1 second'
    )
  $$,
  $$values ('applied'::text, 'won'::text, 'paid'::text, 'active'::text)$$,
  'all favorable disputes leave both payment coverages clean'
);

create temporary table test_case_three_before_single_refund on commit drop as
select
  to_jsonb(commerce_order) as order_row,
  to_jsonb(entitlement) as entitlement_row
from public.commerce_orders as commerce_order
join public.case_entitlements as entitlement
  on entitlement.order_id = commerce_order.id
where commerce_order.case_id = 'd2000000-0000-4000-8000-000000000003';

select results_eq(
  $$
    select outcome, refund_status, order_status, entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_three_recovery),
      're_test_three_primary', 'evt_refund_three_primary',
      'txn_refund_three_primary', null, 'succeeded',
      statement_timestamp() - interval '2 seconds', null
    )
  $$,
  $$values ('succeeded'::text, 'succeeded'::text, 'paid'::text, 'active'::text)$$,
  'refunding the primary payment preserves paid access through the clean duplicate payment'
);

select results_eq(
  $$
    select
      (select to_jsonb(commerce_order)
        from public.commerce_orders as commerce_order
        where commerce_order.case_id = 'd2000000-0000-4000-8000-000000000003')
        = (select order_row from test_case_three_before_single_refund),
      (select to_jsonb(entitlement)
        from public.case_entitlements as entitlement
        where entitlement.case_id = 'd2000000-0000-4000-8000-000000000003')
        = (select entitlement_row from test_case_three_before_single_refund)
  $$,
  $$values (true, true)$$,
  'a nonterminal single-payment refund preserves aggregate order and entitlement timestamps'
);

create temporary table test_refund_three_duplicate on commit drop as
select * from public.reserve_total_loss_refund(
  'd2000000-0000-4000-8000-000000000003',
  (select id from public.commerce_orders
    where case_id = 'd2000000-0000-4000-8000-000000000003'),
  (select id from public.payment_transactions
    where external_object_id = 'pi_test_three_duplicate'),
  'd5000000-0000-4000-8000-000000000031',
  'DUPLICATE_PAYMENT_REMEDIATION', 'revoke'
);

select results_eq(
  $$
    select state, refund_status, order_status, entitlement_status
    from test_refund_three_duplicate
  $$,
  $$values ('reserved'::text, 'creating'::text, 'paid'::text, 'active'::text)$$,
  'the duplicate payment can reserve its own exact refund remediation operation'
);

select results_eq(
  $$
    select result.outcome, result.refund_status, result.order_status,
      result.entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_three_duplicate),
      're_test_three_duplicate', 'evt_refund_three_duplicate',
      'txn_refund_three_duplicate', null, 'succeeded',
      statement_timestamp() - interval '1 second', null
    ) as result
  $$,
  $$values ('succeeded'::text, 'succeeded'::text, 'refunded'::text,
    'revoked'::text)$$,
  'refunding every successful payment applies the latest effective refund access policy'
);

select results_eq(
  $$
    select reason_code
    from public.case_entitlements
    where case_id = 'd2000000-0000-4000-8000-000000000003'
  $$,
  $$values ('DUPLICATE_PAYMENT_REMEDIATION'::text)$$,
  'the final effective refund deterministically supplies the access-policy reason'
);

select results_eq(
  $$
    select outcome, refund_status, order_status, entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_three_duplicate),
      're_test_three_duplicate', 'evt_refund_three_duplicate_reversed',
      'txn_refund_three_duplicate', 'txn_refund_three_duplicate_reversal',
      'failed', statement_timestamp(), 'PROVIDER_REVERSED'
    )
  $$,
  $$values ('failed'::text, 'failed'::text, 'paid'::text, 'active'::text)$$,
  'reversing either effective refund restores clean payment coverage and active access'
);

select results_eq(
  $$
    select outcome, refund_status, order_status, entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_three_recovery),
      're_test_three_primary', 'evt_refund_three_primary_reversed',
      'txn_refund_three_primary', 'txn_refund_three_primary_reversal',
      'failed', statement_timestamp(), 'PROVIDER_REVERSED'
    )
  $$,
  $$values ('failed'::text, 'failed'::text, 'paid'::text, 'active'::text)$$,
  'reversing the remaining refund leaves both immutable successful payments as clean coverage'
);

select results_eq(
  $$
    select
      (select count(*) from public.payment_transactions
        where case_id = 'd2000000-0000-4000-8000-000000000003'
          and transaction_kind = 'payment'),
      (select count(*) from public.payment_transactions
        where case_id = 'd2000000-0000-4000-8000-000000000003'
          and transaction_kind = 'refund'),
      (select count(*) from public.payment_transactions
        where case_id = 'd2000000-0000-4000-8000-000000000003'
          and transaction_kind = 'adjustment'),
      (select count(*) from public.case_entitlements
        where case_id = 'd2000000-0000-4000-8000-000000000003')
  $$,
  $$values (2::bigint, 2::bigint, 2::bigint, 1::bigint)$$,
  'aggregate coverage preserves both payment and refund-remediation evidence with one entitlement'
);

create temporary table test_checkout_four on commit drop as
select * from public.reserve_total_loss_checkout(
  'd2000000-0000-4000-8000-000000000004',
  'd1000000-0000-4000-8000-000000000001', gen_random_uuid(),
  'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
  'terms-1', 'refund-1', false
);
select pg_temp.pay_reserved_checkout(
  (select order_id from test_checkout_four),
  (select checkout_attempt_id from test_checkout_four),
  'cs_test_four', 'pi_test_four', 'evt_checkout_four',
  'd4000000-0000-4000-8000-000000000040'
);

create temporary table test_refund_four_existing on commit drop as
select * from public.reserve_total_loss_refund(
  'd2000000-0000-4000-8000-000000000004',
  (select order_id from test_checkout_four),
  (select id from public.payment_transactions
    where external_object_id = 'pi_test_four'),
  'd5000000-0000-4000-8000-000000000040',
  'CUSTOMER_CANCELLATION', 'retain'
);

select * from public.record_total_loss_refund_result(
  (select refund_request_id from test_refund_four_existing),
  're_test_four_pending', 'evt_refund_four_pending', null, null, 'pending',
  statement_timestamp() - interval '12 seconds', null
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000004',
      (select order_id from test_checkout_four),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_four'),
      'dp_test_four', 'evt_dispute_four_open',
      'charge.dispute.created', 'active', 5000, 'USD',
      statement_timestamp() - interval '10 seconds'
    )
  $$,
  $$values ('applied'::text, 'active'::text, 'disputed'::text,
    'suspended'::text)$$,
  'a positive partial dispute warning suspends access without inventing a funds movement'
);

select results_eq(
  $$
    select state, refund_status, provider_status, external_refund_id,
      order_status, entitlement_status
    from public.reserve_total_loss_refund(
      'd2000000-0000-4000-8000-000000000004',
      (select order_id from test_checkout_four),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_four'),
      'd5000000-0000-4000-8000-000000000040',
      'CUSTOMER_CANCELLATION', 'retain'
    )
  $$,
  $$values ('existing'::text, 'pending'::text, 'pending'::text,
    're_test_four_pending'::text, 'disputed'::text, 'suspended'::text)$$,
  'an exact persisted refund retry returns zero-provider projection after a later dispute'
);

select results_eq(
  $$
    select
      (select count(*) from public.payment_transactions
        where order_id = (select order_id from test_checkout_four)
          and transaction_kind = 'dispute'),
      (select count(*) from public.payment_transactions
        where order_id = (select order_id from test_checkout_four)
          and transaction_kind = 'dispute_reversal')
  $$,
  $$values (0::bigint, 0::bigint)$$,
  'warning and inquiry state is separate from authoritative funds movement evidence'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000004',
      (select order_id from test_checkout_four),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_four'),
      'dp_test_four', 'evt_dispute_four_formal',
      'charge.dispute.updated', 'active', 5000, 'USD',
      statement_timestamp() - interval '9 seconds'
    )
  $$,
  $$values ('applied'::text, 'active'::text, 'disputed'::text,
    'suspended'::text)$$,
  'a warning can progress to a formal active dispute without recording a debit'
);

select results_eq(
  $$
    select outcome, dispute_status, financial_transaction_id is not null,
      order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000004',
      (select order_id from test_checkout_four),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_four'),
      'dp_test_four', 'evt_dispute_four_withdrawn',
      'charge.dispute.funds_withdrawn', 'active', 5000, 'USD',
      statement_timestamp() - interval '8 seconds'
    )
  $$,
  $$values ('applied'::text, 'active'::text, true,
    'disputed'::text, 'suspended'::text)$$,
  'only an authoritative funds-withdrawn event records the immutable dispute debit'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000004',
      (select order_id from test_checkout_four),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_four'),
      'dp_test_four_sibling', 'evt_dispute_four_sibling_won',
      'charge.dispute.closed', 'won', 2500, 'USD',
      statement_timestamp() - interval '7 seconds'
    )
  $$,
  $$values ('applied'::text, 'won'::text, 'disputed'::text,
    'suspended'::text)$$,
  'a favorable sibling cannot restore access while another dispute remains active'
);

select results_eq(
  $$
    select prior_order_status::text, prior_entitlement_status::text,
      (select count(*) from public.payment_transactions
        where external_object_id like 'dp_test_four_sibling:%')
    from public.commerce_disputes
    where external_dispute_id = 'dp_test_four_sibling'
  $$,
  $$values ('paid'::text, 'active'::text, 0::bigint)$$,
  'later disputes inherit the original pre-dispute baseline and favorable closure has no debit'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000004',
      (select order_id from test_checkout_four),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_four'),
      'dp_test_four', 'evt_dispute_four_old',
      'charge.dispute.closed', 'won', 5000, 'USD',
      statement_timestamp() - interval '11 seconds'
    )
  $$,
  $$values ('stale'::text, 'active'::text, 'disputed'::text,
    'suspended'::text)$$,
  'an older out-of-order status event cannot regress the current dispute projection'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000004',
      (select order_id from test_checkout_four),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_four'),
      'dp_test_four', 'evt_dispute_four_won',
      'charge.dispute.closed', 'won', 5000, 'USD',
      statement_timestamp() - interval '6 seconds'
    )
  $$,
  $$values ('applied'::text, 'won'::text, 'paid'::text, 'active'::text)$$,
  'access restores only after every known sibling dispute is favorable'
);

select results_eq(
  $$
    select outcome, dispute_status, financial_transaction_id is not null,
      order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000004',
      (select order_id from test_checkout_four),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_four'),
      'dp_test_four', 'evt_dispute_four_reinstated',
      'charge.dispute.funds_reinstated', 'won', 5000, 'USD',
      statement_timestamp() - interval '5 seconds'
    )
  $$,
  $$values ('applied'::text, 'won'::text, true,
    'paid'::text, 'active'::text)$$,
  'funds reinstatement records a separate reversal without changing favorable access'
);

select results_eq(
  $$
    select outcome, dispute_status, financial_transaction_id,
      order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000004',
      (select order_id from test_checkout_four),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_four'),
      'dp_test_four', 'evt_dispute_four_reinstated',
      'charge.dispute.funds_reinstated', 'won', 5000, 'USD',
      (select funds_reinstated_occurred_at from public.commerce_disputes
        where external_dispute_id = 'dp_test_four')
    )
  $$,
  $$values ('duplicate'::text, 'won'::text, null::uuid,
    'paid'::text, 'active'::text)$$,
  'replayed funds reinstatement is idempotent'
);

select results_eq(
  $$
    select
      (select count(*) from public.payment_transactions
        where order_id = (select order_id from test_checkout_four)
          and transaction_kind = 'dispute'),
      (select count(*) from public.payment_transactions
        where order_id = (select order_id from test_checkout_four)
          and transaction_kind = 'dispute_reversal'),
      (select reversal.related_transaction_id = debit.id
        from public.payment_transactions as reversal
        join public.payment_transactions as debit
          on debit.external_object_id = 'dp_test_four:debit'
        where reversal.external_object_id = 'dp_test_four:reversal')
  $$,
  $$values (1::bigint, 1::bigint, true)$$,
  'dispute debit and reinstatement remain distinct, linked, immutable movements'
);

create temporary table test_checkout_seven on commit drop as
select * from public.reserve_total_loss_checkout(
  'd2000000-0000-4000-8000-000000000007',
  'd1000000-0000-4000-8000-000000000001', gen_random_uuid(),
  'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
  'terms-1', 'refund-1', false
);
select pg_temp.pay_reserved_checkout(
  (select order_id from test_checkout_seven),
  (select checkout_attempt_id from test_checkout_seven),
  'cs_test_seven', 'pi_test_seven', 'evt_checkout_seven',
  'd4000000-0000-4000-8000-000000000070'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000007',
      (select order_id from test_checkout_seven),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_seven'),
      'dp_test_seven_sibling', 'evt_dispute_seven_sibling_won',
      'charge.dispute.closed', 'won', 1000, 'USD',
      statement_timestamp() - interval '8 seconds'
    )
  $$,
  $$values ('applied'::text, 'won'::text, 'paid'::text,
    'active'::text)$$,
  'a favorable first-observed dispute closes without inventing debit or changing access'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000007',
      (select order_id from test_checkout_seven),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_seven'),
      'dp_test_seven', 'evt_dispute_seven_lost',
      'charge.dispute.closed', 'lost', 10400, 'USD',
      statement_timestamp() - interval '7 seconds'
    )
  $$,
  $$values ('applied'::text, 'lost'::text, 'disputed'::text,
    'suspended'::text)$$,
  'a later larger-than-charge loss preserves the earlier favorable sibling and suspends access'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000007',
      (select order_id from test_checkout_seven),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_seven'),
      'dp_test_seven', 'evt_dispute_seven_old_win',
      'charge.dispute.closed', 'won', 10400, 'USD',
      statement_timestamp() - interval '9 seconds'
    )
  $$,
  $$values ('stale'::text, 'lost'::text, 'disputed'::text,
    'suspended'::text)$$,
  'an older reported win cannot rewrite a terminal loss'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000007',
      (select order_id from test_checkout_seven),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_seven'),
      'dp_test_seven', 'evt_dispute_seven_late_win',
      'charge.dispute.closed', 'won', 10400, 'USD',
      (select provider_occurred_at from public.commerce_disputes
        where external_dispute_id = 'dp_test_seven')
    )
  $$,
  $$values ('applied'::text, 'won'::text, 'paid'::text, 'active'::text)$$,
  'an equal-second authoritative late win can restore access after all disputes become favorable'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000007',
      (select order_id from test_checkout_seven),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_seven'),
      'dp_test_seven', 'evt_dispute_seven_late_win',
      'charge.dispute.closed', 'won', 10400, 'USD',
      (select provider_occurred_at from public.commerce_disputes
        where external_dispute_id = 'dp_test_seven')
    )
  $$,
  $$values ('duplicate'::text, 'won'::text, 'paid'::text,
    'active'::text)$$,
  'a replayed late win is idempotent'
);

select results_eq(
  $$
    select outcome, dispute_status, financial_transaction_id,
      order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000007',
      (select order_id from test_checkout_seven),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_seven'),
      'dp_test_seven', 'evt_dispute_seven_reinstated',
      'charge.dispute.funds_reinstated', 'won', 10400, 'USD',
      statement_timestamp() - interval '5 seconds'
    )
  $$,
  $$values ('applied'::text, 'won'::text, null::uuid,
    'paid'::text, 'active'::text)$$,
  'reinstatement arriving before withdrawal is retained without inventing a reversal source'
);

select results_eq(
  $$
    select outcome, dispute_status, financial_transaction_id is not null,
      order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000007',
      (select order_id from test_checkout_seven),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_seven'),
      'dp_test_seven', 'evt_dispute_seven_withdrawn',
      'charge.dispute.funds_withdrawn', 'won', 10400, 'USD',
      statement_timestamp() - interval '10 seconds'
    )
  $$,
  $$values ('applied'::text, 'won'::text, true,
    'paid'::text, 'active'::text)$$,
  'an older funds-withdrawn event still records debit and pairs deferred reinstatement'
);

select results_eq(
  $$
    select
      (select count(*) from public.payment_transactions
        where order_id = (select order_id from test_checkout_seven)
          and transaction_kind = 'dispute'),
      (select count(*) from public.payment_transactions
        where order_id = (select order_id from test_checkout_seven)
          and transaction_kind = 'dispute_reversal'),
      (select reversal.related_transaction_id = debit.id
        from public.payment_transactions as reversal
        join public.payment_transactions as debit
          on debit.external_object_id = 'dp_test_seven:debit'
        where reversal.external_object_id = 'dp_test_seven:reversal'),
      (select amount_minor_units from public.payment_transactions
        where external_object_id = 'dp_test_seven:debit')
  $$,
  $$values (1::bigint, 1::bigint, true, 10400::bigint)$$,
  'out-of-order funds movements remain linked once each at the provider amount'
);

select results_eq(
  $$
    select outcome,
      (select count(*) from public.payment_transactions
        where external_object_id like 'dp_test_seven:%')
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000007',
      (select order_id from test_checkout_seven),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_seven'),
      'dp_test_seven', 'evt_dispute_seven_reinstated',
      'charge.dispute.funds_reinstated', 'won', 10400, 'USD',
      (select funds_reinstated_occurred_at from public.commerce_disputes
        where external_dispute_id = 'dp_test_seven')
    )
  $$,
  $$values ('duplicate'::text, 2::bigint)$$,
  'replayed out-of-order movement events cannot duplicate financial history'
);

create temporary table test_checkout_twelve on commit drop as
select * from public.reserve_total_loss_checkout(
  'd2000000-0000-4000-8000-000000000012',
  'd1000000-0000-4000-8000-000000000001', gen_random_uuid(),
  'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
  'terms-1', 'refund-1', false
);
select pg_temp.pay_reserved_checkout(
  (select order_id from test_checkout_twelve),
  (select checkout_attempt_id from test_checkout_twelve),
  'cs_test_twelve', 'pi_test_twelve', 'evt_checkout_twelve',
  'd4000000-0000-4000-8000-000000000120'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000012',
      (select order_id from test_checkout_twelve),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_twelve'),
      'dp_test_twelve_a', 'evt_dispute_twelve_a_won',
      'charge.dispute.closed', 'won', 9900, 'USD',
      statement_timestamp() - interval '10 seconds'
    )
  $$,
  $$values ('applied'::text, 'won'::text, 'paid'::text, 'active'::text)$$,
  'a favorable first dispute closes against the then-current paid baseline'
);

create temporary table test_refund_twelve on commit drop as
select * from public.reserve_total_loss_refund(
  'd2000000-0000-4000-8000-000000000012',
  (select order_id from test_checkout_twelve),
  (select id from public.payment_transactions
    where external_object_id = 'pi_test_twelve'),
  'd5000000-0000-4000-8000-000000000120',
  'FAIR_RESULT', 'retain'
);

select results_eq(
  $$
    select outcome, order_status, entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_twelve),
      're_test_twelve', 'evt_refund_twelve', 'txn_refund_twelve', null,
      'succeeded', statement_timestamp() - interval '8 seconds', null
    )
  $$,
  $$values ('succeeded'::text, 'refunded'::text,
    'refunded_access_retained'::text)$$,
  'a retained-access refund establishes a newer post-dispute commerce baseline'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000012',
      (select order_id from test_checkout_twelve),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_twelve'),
      'dp_test_twelve_b', 'evt_dispute_twelve_b_open',
      'charge.dispute.created', 'active', 9900, 'USD',
      statement_timestamp() - interval '6 seconds'
    )
  $$,
  $$values ('applied'::text, 'active'::text, 'refunded'::text,
    'suspended'::text)$$,
  'a later dispute suspends access without erasing the effective full-refund projection'
);

select results_eq(
  $$
    select prior_order_status::text, prior_entitlement_status::text,
      prior_entitlement_reason_code
    from public.commerce_disputes
    where external_dispute_id = 'dp_test_twelve_b'
  $$,
  $$values ('refunded'::text, 'refunded_access_retained'::text,
    'FAIR_RESULT'::text)$$,
  'a new dispute inherits only an unresolved sibling baseline and otherwise freezes current refund state'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000012',
      (select order_id from test_checkout_twelve),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_twelve'),
      'dp_test_twelve_b', 'evt_dispute_twelve_b_won',
      'charge.dispute.closed', 'won', 9900, 'USD',
      (select provider_occurred_at from public.commerce_disputes
        where external_dispute_id = 'dp_test_twelve_b')
    )
  $$,
  $$values ('applied'::text, 'won'::text, 'refunded'::text,
    'refunded_access_retained'::text)$$,
  'an equal-second active-to-won transition restores the current retained-refund projection'
);

create temporary table test_twelve_projection_before_replay on commit drop as
select to_jsonb(commerce_order) as order_row,
  to_jsonb(entitlement) as entitlement_row
from public.commerce_orders as commerce_order
join public.case_entitlements as entitlement
  on entitlement.order_id = commerce_order.id
where commerce_order.id = (select order_id from test_checkout_twelve);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000012',
      (select order_id from test_checkout_twelve),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_twelve'),
      'dp_test_twelve_b', 'evt_dispute_twelve_b_won',
      'charge.dispute.closed', 'won', 9900, 'USD',
      (select provider_occurred_at from public.commerce_disputes
        where external_dispute_id = 'dp_test_twelve_b')
    )
  $$,
  $$values ('duplicate'::text, 'won'::text, 'refunded'::text,
    'refunded_access_retained'::text)$$,
  'an exact favorable dispute replay is idempotent'
);

select results_eq(
  $$
    select to_jsonb(commerce_order) = replay.order_row,
      to_jsonb(entitlement) = replay.entitlement_row
    from public.commerce_orders as commerce_order
    join public.case_entitlements as entitlement
      on entitlement.order_id = commerce_order.id
    cross join test_twelve_projection_before_replay as replay
    where commerce_order.id = (select order_id from test_checkout_twelve)
  $$,
  $$values (true, true)$$,
  'duplicate dispute replay preserves the complete order and entitlement rows including timestamps'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000012',
      (select order_id from test_checkout_twelve),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_twelve'),
      'dp_test_twelve_b', 'evt_dispute_twelve_b_reverse',
      'charge.dispute.updated', 'active', 9900, 'USD',
      (select provider_occurred_at from public.commerce_disputes
        where external_dispute_id = 'dp_test_twelve_b')
    )
  $$,
  $$values ('stale'::text, 'won'::text, 'refunded'::text,
    'refunded_access_retained'::text)$$,
  'an equal-second reverse event cannot regress a won dispute or the later refund baseline'
);

select results_eq(
  $$
    select to_jsonb(commerce_order) = replay.order_row,
      to_jsonb(entitlement) = replay.entitlement_row
    from public.commerce_orders as commerce_order
    join public.case_entitlements as entitlement
      on entitlement.order_id = commerce_order.id
    cross join test_twelve_projection_before_replay as replay
    where commerce_order.id = (select order_id from test_checkout_twelve)
  $$,
  $$values (true, true)$$,
  'stale dispute replay preserves the complete order and entitlement rows including timestamps'
);

create temporary table test_checkout_fourteen on commit drop as
select * from public.reserve_total_loss_checkout(
  'd2000000-0000-4000-8000-000000000014',
  'd1000000-0000-4000-8000-000000000001', gen_random_uuid(),
  'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
  'terms-1', 'refund-1', false
);
select pg_temp.pay_reserved_checkout(
  (select order_id from test_checkout_fourteen),
  (select checkout_attempt_id from test_checkout_fourteen),
  'cs_test_fourteen', 'pi_test_fourteen', 'evt_checkout_fourteen',
  'd4000000-0000-4000-8000-000000000140'
);
select * from public.record_total_loss_dispute(
  'd2000000-0000-4000-8000-000000000014',
  (select order_id from test_checkout_fourteen),
  (select id from public.payment_transactions
    where external_object_id = 'pi_test_fourteen'),
  'dp_test_fourteen', 'evt_dispute_fourteen_open',
  'charge.dispute.created', 'active', 9900, 'USD',
  statement_timestamp() - interval '6 seconds'
);

create temporary table test_refund_fourteen on commit drop as
select * from public.reserve_total_loss_refund(
  'd2000000-0000-4000-8000-000000000014',
  (select order_id from test_checkout_fourteen),
  (select id from public.payment_transactions
    where external_object_id = 'pi_test_fourteen'),
  'd5000000-0000-4000-8000-000000000140',
  'FAIR_RESULT', 'retain'
);

select results_eq(
  $$
    select outcome, order_status, entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_fourteen),
      're_test_fourteen', 'evt_refund_fourteen',
      'txn_refund_fourteen', null, 'succeeded',
      statement_timestamp() - interval '5 seconds', null
    )
  $$,
  $$values ('succeeded'::text, 'refunded'::text, 'suspended'::text)$$,
  'refund success during an active dispute preserves suspended access and records refunded payment state'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000014',
      (select order_id from test_checkout_fourteen),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_fourteen'),
      'dp_test_fourteen', 'evt_dispute_fourteen_won',
      'charge.dispute.closed', 'won', 9900, 'USD',
      statement_timestamp() - interval '4 seconds'
    )
  $$,
  $$values ('applied'::text, 'won'::text, 'refunded'::text,
    'refunded_access_retained'::text)$$,
  'winning the dispute after refund success restores the explicit retained-refund access policy'
);

create temporary table test_checkout_fifteen on commit drop as
select * from public.reserve_total_loss_checkout(
  'd2000000-0000-4000-8000-000000000015',
  'd1000000-0000-4000-8000-000000000001', gen_random_uuid(),
  'total-loss-package', '1', 'price_test_total_loss_v1', 9900, 'USD',
  'terms-1', 'refund-1', false
);
select pg_temp.pay_reserved_checkout(
  (select order_id from test_checkout_fifteen),
  (select checkout_attempt_id from test_checkout_fifteen),
  'cs_test_fifteen', 'pi_test_fifteen', 'evt_checkout_fifteen',
  'd4000000-0000-4000-8000-000000000150'
);

create temporary table test_refund_fifteen_old on commit drop as
select * from public.reserve_total_loss_refund(
  'd2000000-0000-4000-8000-000000000015',
  (select order_id from test_checkout_fifteen),
  (select id from public.payment_transactions
    where external_object_id = 'pi_test_fifteen'),
  'd5000000-0000-4000-8000-000000000151',
  'CUSTOMER_CANCELLATION', 'retain'
);

select results_eq(
  $$
    select outcome, refund_status, order_status, entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_fifteen_old),
      're_test_fifteen_old', 'evt_refund_fifteen_old_failed', null, null,
      'failed', statement_timestamp() - interval '8 seconds',
      'PROVIDER_DECLINED'
    )
  $$,
  $$values ('failed'::text, 'failed'::text, 'paid'::text, 'active'::text)$$,
  'an earlier provider-failed refund leaves the order eligible for a later request'
);

select * from public.record_total_loss_dispute(
  'd2000000-0000-4000-8000-000000000015',
  (select order_id from test_checkout_fifteen),
  (select id from public.payment_transactions
    where external_object_id = 'pi_test_fifteen'),
  'dp_test_fifteen', 'evt_dispute_fifteen_open',
  'charge.dispute.created', 'active', 9900, 'USD',
  statement_timestamp() - interval '6 seconds'
);

create temporary table test_refund_fifteen on commit drop as
select * from public.reserve_total_loss_refund(
  'd2000000-0000-4000-8000-000000000015',
  (select order_id from test_checkout_fifteen),
  (select id from public.payment_transactions
    where external_object_id = 'pi_test_fifteen'),
  'd5000000-0000-4000-8000-000000000150',
  'FAIR_RESULT', 'retain'
);
select * from public.record_total_loss_refund_result(
  (select refund_request_id from test_refund_fifteen),
  're_test_fifteen', 'evt_refund_fifteen', 'txn_refund_fifteen', null,
  'succeeded', statement_timestamp() - interval '5 seconds', null
);

select results_eq(
  $$
    select outcome, refund_status, provider_status,
      refund_transaction_id, refund_reversal_transaction_id,
      order_status, entitlement_status
    from public.record_total_loss_refund_result(
      (select refund_request_id from test_refund_fifteen_old),
      're_test_fifteen_old', 'evt_refund_fifteen_old_failed', null, null,
      'failed',
      (select provider_occurred_at from public.commerce_refund_requests
        where id = (select refund_request_id from test_refund_fifteen_old)),
      'PROVIDER_DECLINED'
    )
  $$,
  $$values ('stale'::text, 'failed'::text, 'failed'::text, null::uuid,
    null::uuid, 'refunded'::text, 'suspended'::text)$$,
  'replaying an earlier failed refund preserves its audit row while returning the later disputed refund projection'
);

select results_eq(
  $$
    select outcome, dispute_status, order_status, entitlement_status
    from public.record_total_loss_dispute(
      'd2000000-0000-4000-8000-000000000015',
      (select order_id from test_checkout_fifteen),
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_fifteen'),
      'dp_test_fifteen', 'evt_dispute_fifteen_lost',
      'charge.dispute.closed', 'lost', 9900, 'USD',
      (select provider_occurred_at from public.commerce_disputes
        where external_dispute_id = 'dp_test_fifteen')
    )
  $$,
  $$values ('applied'::text, 'lost'::text, 'refunded'::text,
    'suspended'::text)$$,
  'an equal-second active-to-lost transition keeps refunded payment state and suspended access'
);

select results_eq(
  $$
    select case_id, order_id, checkout_attempt_id, payment_transaction_id,
      external_payment_intent_id, order_status, entitlement_status
    from public.resolve_total_loss_payment_context('pi_test_four')
  $$,
  $$
    select
      'd2000000-0000-4000-8000-000000000004'::uuid,
      order_id,
      checkout_attempt_id,
      (select id from public.payment_transactions
        where external_object_id = 'pi_test_four'),
      'pi_test_four'::text,
      'paid'::text,
      'active'::text
    from test_checkout_four
  $$,
  'PaymentIntent lookup supplies the authoritative local refund/dispute context'
);

reset role;

select is(
  public.total_loss_case_identity_transfer_allowed_internal(
    'd2000000-0000-4000-8000-000000000004'
  ),
  false,
  'paid commerce and entitlement continue fencing later ordinary ownership transfer'
);

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'stripe_webhook_events',
        'commerce_refund_requests',
        'commerce_disputes'
      )
      and column_name in (
        'raw_payload', 'payload', 'vin', 'claim_number', 'insurer_name',
        'customer_email', 'external_customer_id'
      )
  ),
  'provider audit tables contain no raw payload or unnecessary customer claim facts'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-4000-8000-000000000001';

select is(
  (
    select count(*)
    from public.case_entitlements
    where case_id in (
      'd2000000-0000-4000-8000-000000000001',
      'd2000000-0000-4000-8000-000000000002',
      'd2000000-0000-4000-8000-000000000003',
      'd2000000-0000-4000-8000-000000000004',
      'd2000000-0000-4000-8000-000000000006',
      'd2000000-0000-4000-8000-000000000007',
      'd2000000-0000-4000-8000-000000000009',
      'd2000000-0000-4000-8000-000000000012',
      'd2000000-0000-4000-8000-000000000013',
      'd2000000-0000-4000-8000-000000000014',
      'd2000000-0000-4000-8000-000000000015'
    )
  ),
  11::bigint,
  'the current permanent owner can read only their customer-safe entitlements'
);

select throws_ok(
  $$select count(*) from public.commerce_orders$$,
  '42501',
  null,
  'browser owners cannot read server-only logical orders directly'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-4000-8000-000000000002';

select is(
  (select count(*) from public.case_entitlements),
  0::bigint,
  'a wrong permanent owner cannot read another customer entitlement'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-4000-8000-000000000003';

select is(
  (select count(*) from public.case_entitlements),
  0::bigint,
  'an anonymous Auth identity cannot read post-payment entitlements'
);

reset role;

select * from finish();
rollback;
