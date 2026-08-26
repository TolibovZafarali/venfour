begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(123);

select is(
  (
    select array_agg(relation.relname::text order by relation.relname)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind = 'r'
      and relation.relname = any (array[
        'case_entitlements',
        'checkout_attempts',
        'commerce_orders',
        'payment_transactions',
        'total_loss_ai_review_runs',
        'total_loss_claim_documents',
        'total_loss_claim_workflows',
        'total_loss_communication_documents',
        'total_loss_communications',
        'total_loss_education_progress',
        'total_loss_fact_assertions',
        'total_loss_final_assessments',
        'total_loss_message_drafts',
        'total_loss_message_versions',
        'total_loss_negotiation_rounds',
        'total_loss_offers',
        'total_loss_package_jobs',
        'total_loss_preliminary_snapshots',
        'total_loss_recommendations',
        'total_loss_release_reviews',
        'total_loss_report_series',
        'total_loss_report_versions',
        'total_loss_workflow_events'
      ])
  ),
  array[
    'case_entitlements',
    'checkout_attempts',
    'commerce_orders',
    'payment_transactions',
    'total_loss_ai_review_runs',
    'total_loss_claim_documents',
    'total_loss_claim_workflows',
    'total_loss_communication_documents',
    'total_loss_communications',
    'total_loss_education_progress',
    'total_loss_fact_assertions',
    'total_loss_final_assessments',
    'total_loss_message_drafts',
    'total_loss_message_versions',
    'total_loss_negotiation_rounds',
    'total_loss_offers',
    'total_loss_package_jobs',
    'total_loss_preliminary_snapshots',
    'total_loss_recommendations',
    'total_loss_release_reviews',
    'total_loss_report_series',
    'total_loss_report_versions',
    'total_loss_workflow_events'
  ]::text[],
  'the complete additive post-Continue table catalog exists'
);

select is(
  (
    select array_agg(enum_value.enumlabel::text order by enum_value.enumsortorder)
    from pg_enum as enum_value
    where enum_value.enumtypid = 'public.total_loss_claim_phase'::regtype
  ),
  array['review', 'initial_request', 'negotiation', 'resolution']::text[],
  'claim phases are stable and intentionally small'
);

select is(
  (
    select array_agg(enum_value.enumlabel::text order by enum_value.enumsortorder)
    from pg_enum as enum_value
    where enum_value.enumtypid = 'public.commerce_order_status'::regtype
  ),
  array['pending', 'paid', 'partially_refunded', 'refunded', 'disputed', 'void']::text[],
  'commerce order states preserve payment outcomes without overloading case status'
);

select is(
  (
    select array_agg(enum_value.enumlabel::text order by enum_value.enumsortorder)
    from pg_enum as enum_value
    where enum_value.enumtypid = 'public.case_entitlement_status'::regtype
  ),
  array['active', 'refunded_access_retained', 'suspended', 'revoked']::text[],
  'entitlement states remain independent from payment state'
);

select is(
  (
    select array_agg(enum_value.enumlabel::text order by enum_value.enumsortorder)
    from pg_enum as enum_value
    where enum_value.enumtypid = 'public.total_loss_communication_direction'::regtype
  ),
  array['inbound', 'outbound']::text[],
  'communication direction is typed'
);

select is(
  (
    select array_agg(enum_value.enumlabel::text order by enum_value.enumsortorder)
    from pg_enum as enum_value
    where enum_value.enumtypid = 'public.total_loss_communication_channel'::regtype
  ),
  array['email', 'uploaded_document', 'pasted_message', 'phone']::text[],
  'communication channels are typed'
);

select ok(
  (
    select bool_and(relation.relrowsecurity)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any (array[
        'case_entitlements', 'checkout_attempts', 'commerce_orders',
        'payment_transactions', 'total_loss_ai_review_runs',
        'total_loss_claim_documents', 'total_loss_claim_workflows',
        'total_loss_communication_documents', 'total_loss_communications',
        'total_loss_education_progress', 'total_loss_fact_assertions',
        'total_loss_final_assessments', 'total_loss_message_drafts',
        'total_loss_message_versions', 'total_loss_negotiation_rounds',
        'total_loss_offers', 'total_loss_package_jobs',
        'total_loss_preliminary_snapshots', 'total_loss_recommendations',
        'total_loss_release_reviews', 'total_loss_report_series',
        'total_loss_report_versions', 'total_loss_workflow_events'
      ])
  ),
  'RLS is enabled on every new table'
);

select ok(
  not exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    cross join lateral aclexplode(
      coalesce(relation.relacl, acldefault('r', relation.relowner))
    ) as table_acl
    where namespace.nspname = 'public'
      and relation.relname = any (array[
        'case_entitlements', 'checkout_attempts', 'commerce_orders',
        'payment_transactions', 'total_loss_ai_review_runs',
        'total_loss_claim_documents', 'total_loss_claim_workflows',
        'total_loss_communication_documents', 'total_loss_communications',
        'total_loss_education_progress', 'total_loss_fact_assertions',
        'total_loss_final_assessments', 'total_loss_message_drafts',
        'total_loss_message_versions', 'total_loss_negotiation_rounds',
        'total_loss_offers', 'total_loss_package_jobs',
        'total_loss_preliminary_snapshots', 'total_loss_recommendations',
        'total_loss_release_reviews', 'total_loss_report_series',
        'total_loss_report_versions', 'total_loss_workflow_events'
      ])
      and table_acl.grantee in (0, 'anon'::regrole)
  ),
  'PUBLIC and anon receive no table privileges'
);

select ok(
  (
    select bool_and(
      not has_table_privilege('authenticated', 'public.' || table_name, 'INSERT')
      and not has_table_privilege('authenticated', 'public.' || table_name, 'UPDATE')
      and not has_table_privilege('authenticated', 'public.' || table_name, 'DELETE')
    )
    from unnest(array[
      'case_entitlements', 'checkout_attempts', 'commerce_orders',
      'payment_transactions', 'total_loss_ai_review_runs',
      'total_loss_claim_documents', 'total_loss_claim_workflows',
      'total_loss_communication_documents', 'total_loss_communications',
      'total_loss_education_progress', 'total_loss_fact_assertions',
      'total_loss_final_assessments', 'total_loss_message_drafts',
      'total_loss_message_versions', 'total_loss_negotiation_rounds',
      'total_loss_offers', 'total_loss_package_jobs',
      'total_loss_preliminary_snapshots', 'total_loss_recommendations',
      'total_loss_release_reviews', 'total_loss_report_series',
      'total_loss_report_versions', 'total_loss_workflow_events'
    ]) as tables(table_name)
  ),
  'authenticated browser clients receive no direct write privilege'
);

select is(
  (
    select array_agg(table_name order by table_name)
    from unnest(array[
      'case_entitlements', 'checkout_attempts', 'commerce_orders',
      'payment_transactions', 'total_loss_ai_review_runs',
      'total_loss_claim_documents', 'total_loss_claim_workflows',
      'total_loss_communication_documents', 'total_loss_communications',
      'total_loss_education_progress', 'total_loss_fact_assertions',
      'total_loss_final_assessments', 'total_loss_message_drafts',
      'total_loss_message_versions', 'total_loss_negotiation_rounds',
      'total_loss_offers', 'total_loss_package_jobs',
      'total_loss_preliminary_snapshots', 'total_loss_recommendations',
      'total_loss_release_reviews', 'total_loss_report_series',
      'total_loss_report_versions', 'total_loss_workflow_events'
    ]) as tables(table_name)
    where has_table_privilege('authenticated', 'public.' || table_name, 'SELECT')
  ),
  array[
    'case_entitlements',
    'total_loss_ai_review_runs',
    'total_loss_claim_documents',
    'total_loss_claim_workflows',
    'total_loss_communication_documents',
    'total_loss_communications',
    'total_loss_education_progress',
    'total_loss_fact_assertions',
    'total_loss_final_assessments',
    'total_loss_message_drafts',
    'total_loss_message_versions',
    'total_loss_negotiation_rounds',
    'total_loss_offers',
    'total_loss_preliminary_snapshots',
    'total_loss_recommendations',
    'total_loss_release_reviews',
    'total_loss_report_series',
    'total_loss_report_versions'
  ]::text[],
  'authenticated SELECT grants contain only owner and staff-readable surfaces'
);

select ok(
  (
    select bool_and(
      has_table_privilege('service_role', 'public.' || table_name, 'SELECT')
      and has_table_privilege('service_role', 'public.' || table_name, 'INSERT')
    )
    from unnest(array[
      'case_entitlements', 'checkout_attempts', 'commerce_orders',
      'payment_transactions', 'total_loss_ai_review_runs',
      'total_loss_claim_documents', 'total_loss_claim_workflows',
      'total_loss_communication_documents', 'total_loss_communications',
      'total_loss_education_progress', 'total_loss_fact_assertions',
      'total_loss_final_assessments', 'total_loss_message_drafts',
      'total_loss_message_versions', 'total_loss_negotiation_rounds',
      'total_loss_offers', 'total_loss_package_jobs',
      'total_loss_preliminary_snapshots', 'total_loss_recommendations',
      'total_loss_release_reviews', 'total_loss_report_series',
      'total_loss_report_versions', 'total_loss_workflow_events'
    ]) as tables(table_name)
  ),
  'the service role can read and create every server-owned foundation record'
);

select is(
  (
    select array_agg(table_name order by table_name)
    from unnest(array[
      'case_entitlements', 'checkout_attempts', 'commerce_orders',
      'payment_transactions', 'total_loss_ai_review_runs',
      'total_loss_claim_documents', 'total_loss_claim_workflows',
      'total_loss_communication_documents', 'total_loss_communications',
      'total_loss_education_progress', 'total_loss_fact_assertions',
      'total_loss_final_assessments', 'total_loss_message_drafts',
      'total_loss_message_versions', 'total_loss_negotiation_rounds',
      'total_loss_offers', 'total_loss_package_jobs',
      'total_loss_preliminary_snapshots', 'total_loss_recommendations',
      'total_loss_release_reviews', 'total_loss_report_series',
      'total_loss_report_versions', 'total_loss_workflow_events'
    ]) as tables(table_name)
    where has_table_privilege('service_role', 'public.' || table_name, 'UPDATE')
  ),
  array[
    'case_entitlements',
    'checkout_attempts',
    'commerce_orders',
    'total_loss_ai_review_runs',
    'total_loss_claim_documents',
    'total_loss_claim_workflows',
    'total_loss_communication_documents',
    'total_loss_communications',
    'total_loss_education_progress',
    'total_loss_fact_assertions',
    'total_loss_message_drafts',
    'total_loss_negotiation_rounds',
    'total_loss_offers',
    'total_loss_package_jobs',
    'total_loss_recommendations',
    'total_loss_release_reviews',
    'total_loss_report_versions'
  ]::text[],
  'service UPDATE is absent from fully immutable records'
);

select is(
  (
    select array_agg(table_name order by table_name)
    from unnest(array[
      'case_entitlements', 'checkout_attempts', 'commerce_orders',
      'payment_transactions', 'total_loss_ai_review_runs',
      'total_loss_claim_documents', 'total_loss_claim_workflows',
      'total_loss_communication_documents', 'total_loss_communications',
      'total_loss_education_progress', 'total_loss_fact_assertions',
      'total_loss_final_assessments', 'total_loss_message_drafts',
      'total_loss_message_versions', 'total_loss_negotiation_rounds',
      'total_loss_offers', 'total_loss_package_jobs',
      'total_loss_preliminary_snapshots', 'total_loss_recommendations',
      'total_loss_release_reviews', 'total_loss_report_series',
      'total_loss_report_versions', 'total_loss_workflow_events'
    ]) as tables(table_name)
    where has_table_privilege('service_role', 'public.' || table_name, 'DELETE')
  ),
  array['total_loss_communication_documents']::text[],
  'service DELETE is limited to mutable draft attachment links'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 's'
      and 'search_path=""' = any(procedure.proconfig)
    from pg_proc as procedure
    where procedure.oid =
      'public.is_permanent_total_loss_case_owner(uuid)'::regprocedure
  ),
  'the permanent-owner predicate is stable, pinned, and SECURITY DEFINER'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.is_permanent_total_loss_case_owner(uuid)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'anon',
      'public.is_permanent_total_loss_case_owner(uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.is_permanent_total_loss_case_owner(uuid)',
      'EXECUTE'
    ),
  'only authenticated browser sessions can invoke the ownership predicate'
);

select ok(
  (
    select bool_and(
      not procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
    )
    from pg_proc as procedure
    where procedure.oid in (
      'public.reject_total_loss_immutable_record()'::regprocedure,
      'public.protect_total_loss_terminal_record()'::regprocedure,
      'public.protect_total_loss_ai_review_run()'::regprocedure,
      'public.protect_confirmed_total_loss_communication_documents()'::regprocedure,
      'public.protect_total_loss_stable_columns()'::regprocedure,
      'public.require_total_loss_revision_increment()'::regprocedure,
      'public.validate_total_loss_preliminary_snapshot_source()'::regprocedure,
      'public.validate_total_loss_published_report_document()'::regprocedure
    )
  ),
  'all post-Continue trigger guards are pinned SECURITY INVOKER functions'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as function_acl
    where procedure.oid in (
      'public.reject_total_loss_immutable_record()'::regprocedure,
      'public.protect_total_loss_terminal_record()'::regprocedure,
      'public.protect_total_loss_ai_review_run()'::regprocedure,
      'public.protect_confirmed_total_loss_communication_documents()'::regprocedure,
      'public.protect_total_loss_stable_columns()'::regprocedure,
      'public.require_total_loss_revision_increment()'::regprocedure,
      'public.validate_total_loss_preliminary_snapshot_source()'::regprocedure,
      'public.validate_total_loss_published_report_document()'::regprocedure
    )
      and function_acl.grantee in (
        0,
        'anon'::regrole,
        'authenticated'::regrole,
        'service_role'::regrole
      )
      and function_acl.privilege_type = 'EXECUTE'
  ),
  'trigger-only guards have no callable API role surface'
);

select is(
  (
    select array_agg(policy.policyname::text order by policy.policyname)
    from pg_policies as policy
    where policy.schemaname = 'public'
      and (
        policy.policyname like 'Permanent owners can read their %'
        or policy.policyname like 'Staff can read post-Continue %'
      )
  ),
  array[
    'Permanent owners can read their case entitlements',
    'Permanent owners can read their claim workflow',
    'Permanent owners can read their confirmed communication documen',
    'Permanent owners can read their confirmed communications',
    'Permanent owners can read their confirmed facts',
    'Permanent owners can read their education progress',
    'Permanent owners can read their message drafts',
    'Permanent owners can read their message versions',
    'Permanent owners can read their negotiation rounds',
    'Permanent owners can read their published recommendations',
    'Permanent owners can read their published reports',
    'Permanent owners can read their ready claim documents',
    'Permanent owners can read their recorded offers',
    'Permanent owners can read their report series',
    'Staff can read post-Continue AI review runs',
    'Staff can read post-Continue claim documents',
    'Staff can read post-Continue final assessments',
    'Staff can read post-Continue preliminary snapshots',
    'Staff can read post-Continue release reviews',
    'Staff can read post-Continue report versions'
  ]::text[],
  'the post-Continue policy catalog is exact'
);

select ok(
  not exists (
    select 1
    from pg_policies as policy
    where policy.schemaname = 'public'
      and (
        policy.policyname like 'Permanent owners can read their %'
        or policy.policyname like 'Staff can read post-Continue %'
      )
      and (
        policy.cmd <> 'SELECT'
        or policy.roles <> array['authenticated']::name[]
      )
  ),
  'every new browser policy is authenticated SELECT-only'
);

select ok(
  not exists (
    select 1
    from pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename in (
        'commerce_orders',
        'checkout_attempts',
        'payment_transactions',
        'total_loss_package_jobs',
        'total_loss_workflow_events'
      )
  ),
  'financial, worker-lease, and raw audit tables have no browser policy'
);

select ok(
  (
    select bool_and(constraint_record.contype = 'f')
      and count(*) = 16
    from pg_constraint as constraint_record
    where constraint_record.conname = any (array[
      'total_loss_preliminary_snapshots_run_identity_fkey',
      'total_loss_claim_workflows_snapshot_case_fkey',
      'commerce_orders_snapshot_case_fkey',
      'checkout_attempts_order_amount_fkey',
      'payment_transactions_checkout_identity_fkey',
      'case_entitlements_order_identity_fkey',
      'total_loss_package_jobs_entitlement_identity_fkey',
      'total_loss_final_assessments_job_identity_fkey',
      'total_loss_report_versions_series_case_fkey',
      'total_loss_report_versions_assessment_case_fkey',
      'total_loss_ai_review_runs_report_assessment_fkey',
      'total_loss_education_progress_report_case_fkey',
      'total_loss_message_versions_draft_case_fkey',
      'total_loss_communication_documents_document_case_fkey',
      'total_loss_fact_assertions_assessment_case_fkey',
      'total_loss_recommendations_round_case_fkey'
    ])
  ),
  'same-case and lineage foreign keys cover every high-risk boundary'
);

select ok(
  (
    select count(*) = 5
      and bool_and(constraint_record.condeferrable)
      and bool_and(constraint_record.condeferred)
    from pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.total_loss_claim_workflows'::regclass
      and constraint_record.conname like 'total_loss_claim_workflows_current_%_fkey'
  ),
  'all current-workflow pointers are same-case and initially deferred'
);

select ok(
  (
    select count(*) = 9
    from pg_indexes as index_record
    where index_record.schemaname = 'public'
      and index_record.indexname = any (array[
        'checkout_attempts_provider_session_key',
        'checkout_attempts_provider_intent_key',
        'checkout_attempts_one_open_per_order_idx',
        'payment_transactions_provider_object_key',
        'payment_transactions_provider_event_key',
        'case_entitlements_one_nonrevoked_product_idx',
        'total_loss_package_jobs_one_processing_per_case_idx',
        'total_loss_negotiation_rounds_one_open_idx',
        'total_loss_workflow_events_client_request_key'
      ])
  ),
  'idempotency and one-active-record indexes all exist'
);

select is(
  (
    select array_agg(enum_value.enumlabel::text order by enum_value.enumsortorder)
    from pg_enum as enum_value
    where enum_value.enumtypid = 'public.appraisal_case_status'::regtype
  ),
  array[
    'draft', 'submitted', 'checking', 'check_complete', 'payment_pending',
    'paid', 'completed', 'closed'
  ]::text[],
  'the pre-existing appraisal case status contract is unchanged'
);

select ok(
  not has_table_privilege('authenticated', 'public.analysis_runs', 'SELECT')
    and not has_table_privilege('authenticated', 'public.total_loss_analysis_jobs', 'SELECT')
    and has_table_privilege('service_role', 'public.analysis_runs', 'SELECT')
    and not has_table_privilege('service_role', 'public.analysis_runs', 'UPDATE')
    and has_table_privilege('service_role', 'public.total_loss_analysis_jobs', 'SELECT')
    and not has_table_privilege('service_role', 'public.total_loss_analysis_jobs', 'UPDATE'),
  'the existing raw analysis boundary remains read-only and browser-inaccessible'
);

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values
  ('d1111111-1111-4111-8111-111111111111', 'foundation-owner@example.test', statement_timestamp(), false),
  ('d2222222-2222-4222-8222-222222222222', 'foundation-other@example.test', statement_timestamp(), false),
  ('d3333333-3333-4333-8333-333333333333', null, null, true),
  ('d4444444-4444-4444-8444-444444444444', 'foundation-staff@example.test', statement_timestamp(), false);

insert into public.staff_members (user_id)
values ('d4444444-4444-4444-8444-444444444444');

insert into public.appraisal_cases (id, user_id, service_type, status)
values
  ('da111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', 'total_loss', 'check_complete'),
  ('da222222-2222-4222-8222-222222222222', 'd2222222-2222-4222-8222-222222222222', 'total_loss', 'check_complete'),
  ('da333333-3333-4333-8333-333333333333', 'd3333333-3333-4333-8333-333333333333', 'total_loss', 'check_complete');

insert into public.total_loss_analysis_jobs (
  id,
  case_id,
  source_report_upload_id,
  source_details_updated_at,
  status,
  attempt_count,
  processing_token,
  processing_expires_at,
  run_id,
  failure_code,
  retryable,
  finished_at,
  source_intake_mode,
  source_analysis_input_revision,
  source_analysis_input_id
)
values
  (
    'db111111-1111-4111-8111-111111111111',
    'da111111-1111-4111-8111-111111111111',
    null,
    '2026-08-25 01:00:00+00',
    'completed',
    1,
    'dc111111-1111-4111-8111-111111111111',
    null,
    'dd111111-1111-4111-8111-111111111111',
    null,
    null,
    '2026-08-25 01:01:00+00',
    'manual',
    1,
    'de111111-1111-4111-8111-111111111111'
  ),
  (
    'db333333-3333-4333-8333-333333333333',
    'da333333-3333-4333-8333-333333333333',
    null,
    '2026-08-25 01:00:00+00',
    'completed',
    1,
    'dc333333-3333-4333-8333-333333333333',
    null,
    'dd333333-3333-4333-8333-333333333333',
    null,
    null,
    '2026-08-25 01:01:00+00',
    'manual',
    1,
    'de333333-3333-4333-8333-333333333333'
  );

insert into public.analysis_runs (
  id,
  job_id,
  case_id,
  artifact,
  request_digest,
  analysis_run_schema_version,
  analysis_version,
  discrepancy_analysis_version,
  comparable_scoring_version
)
values
  (
    'dd111111-1111-4111-8111-111111111111',
    'db111111-1111-4111-8111-111111111111',
    'da111111-1111-4111-8111-111111111111',
    '{"runId":"dd111111-1111-4111-8111-111111111111"}'::jsonb,
    repeat('1', 64), '4', '4', '1', '1'
  ),
  (
    'dd333333-3333-4333-8333-333333333333',
    'db333333-3333-4333-8333-333333333333',
    'da333333-3333-4333-8333-333333333333',
    '{"runId":"dd333333-3333-4333-8333-333333333333"}'::jsonb,
    repeat('3', 64), '4', '4', '1', '1'
  );

insert into public.total_loss_preliminary_snapshots (
  id,
  case_id,
  analysis_job_id,
  analysis_run_id,
  owner_user_id_at_snapshot,
  source_intake_mode,
  source_report_upload_id,
  source_analysis_input_revision,
  source_analysis_input_id,
  preliminary_classification,
  insurer_valuation_minor_units,
  supported_range_low_minor_units,
  supported_range_median_minor_units,
  supported_range_high_minor_units,
  currency,
  analysis_run_schema_version,
  analysis_version,
  discrepancy_analysis_version,
  comparable_scoring_version,
  presentation_schema_version,
  snapshot_schema_version,
  source_references,
  snapshot,
  snapshot_digest
)
values
  (
    'df111111-1111-4111-8111-111111111111',
    'da111111-1111-4111-8111-111111111111',
    'db111111-1111-4111-8111-111111111111',
    'dd111111-1111-4111-8111-111111111111',
    'd1111111-1111-4111-8111-111111111111',
    'manual', null, 1,
    'de111111-1111-4111-8111-111111111111',
    'MATERIAL_UNDERVALUE_SIGNAL',
    1800000, 2000000, 2100000, 2200000, 'USD',
    '4', '4', '1', '1', '1', '1',
    '{"analysisRun":"dd111111-1111-4111-8111-111111111111"}'::jsonb,
    '{"classification":"MATERIAL_UNDERVALUE_SIGNAL"}'::jsonb,
    repeat('a', 64)
  ),
  (
    'df333333-3333-4333-8333-333333333333',
    'da333333-3333-4333-8333-333333333333',
    'db333333-3333-4333-8333-333333333333',
    'dd333333-3333-4333-8333-333333333333',
    'd3333333-3333-4333-8333-333333333333',
    'manual', null, 1,
    'de333333-3333-4333-8333-333333333333',
    'MATERIAL_UNDERVALUE_SIGNAL',
    1700000, 1900000, 2000000, 2100000, 'USD',
    '4', '4', '1', '1', '1', '1',
    '{"analysisRun":"dd333333-3333-4333-8333-333333333333"}'::jsonb,
    '{"classification":"MATERIAL_UNDERVALUE_SIGNAL"}'::jsonb,
    repeat('b', 64)
  );

insert into public.total_loss_claim_workflows (
  case_id, preliminary_snapshot_id, phase, current_task
)
values
  ('da111111-1111-4111-8111-111111111111', 'df111111-1111-4111-8111-111111111111', 'review', 'review_result'),
  ('da333333-3333-4333-8333-333333333333', 'df333333-3333-4333-8333-333333333333', 'review', 'review_result');

insert into public.commerce_orders (
  id, case_id, purchaser_user_id, preliminary_snapshot_id,
  product_identifier, product_version, amount_minor_units, currency,
  status, terms_version, refund_policy_version
)
values (
  'e0111111-1111-4111-8111-111111111111',
  'da111111-1111-4111-8111-111111111111',
  'd1111111-1111-4111-8111-111111111111',
  'df111111-1111-4111-8111-111111111111',
  'total-loss-package', '1', 9900, 'USD', 'pending', '1', '1'
);

insert into public.checkout_attempts (
  id, case_id, order_id, client_request_id, payment_provider,
  external_checkout_session_id, status, amount_minor_units, currency, expires_at
)
values (
  'e0211111-1111-4111-8111-111111111111',
  'da111111-1111-4111-8111-111111111111',
  'e0111111-1111-4111-8111-111111111111',
  'e0311111-1111-4111-8111-111111111111',
  'stripe', 'cs_foundation_1', 'open', 9900, 'USD',
  statement_timestamp() + interval '30 minutes'
);

insert into public.payment_transactions (
  id, case_id, order_id, checkout_attempt_id, payment_provider,
  transaction_kind, external_object_id, external_event_id,
  amount_minor_units, currency, provider_occurred_at
)
values (
  'e0411111-1111-4111-8111-111111111111',
  'da111111-1111-4111-8111-111111111111',
  'e0111111-1111-4111-8111-111111111111',
  'e0211111-1111-4111-8111-111111111111',
  'stripe', 'payment', 'pi_foundation_1', 'evt_foundation_1',
  9900, 'USD', statement_timestamp()
);

insert into public.case_entitlements (
  id, case_id, order_id, preliminary_snapshot_id,
  product_identifier, product_version, status
)
values (
  'e0511111-1111-4111-8111-111111111111',
  'da111111-1111-4111-8111-111111111111',
  'e0111111-1111-4111-8111-111111111111',
  'df111111-1111-4111-8111-111111111111',
  'total-loss-package', '1', 'active'
);

insert into public.total_loss_package_jobs (
  id, case_id, entitlement_id, preliminary_snapshot_id, status
)
values (
  'e0611111-1111-4111-8111-111111111111',
  'da111111-1111-4111-8111-111111111111',
  'e0511111-1111-4111-8111-111111111111',
  'df111111-1111-4111-8111-111111111111',
  'queued'
);

insert into public.total_loss_final_assessments (
  id, case_id, package_job_id, preliminary_snapshot_id, version_number,
  conclusion_code, currency, supported_range_low_minor_units,
  supported_range_median_minor_units, supported_range_high_minor_units,
  findings, limitations, reason_codes, preliminary_to_final_comparison,
  assessment, methodology_version, schema_version, assessment_digest
)
values (
  'e0711111-1111-4111-8111-111111111111',
  'da111111-1111-4111-8111-111111111111',
  'e0611111-1111-4111-8111-111111111111',
  'df111111-1111-4111-8111-111111111111',
  1, 'SUPPORTED', 'USD', 2000000, 2100000, 2200000,
  '[]'::jsonb, '[]'::jsonb, '["SUPPORTED"]'::jsonb,
  '{"changed":false}'::jsonb, '{"conclusion":"SUPPORTED"}'::jsonb,
  '1', '1', repeat('c', 64)
);

insert into public.total_loss_report_series (
  id, case_id, product_identifier, report_kind
)
values (
  'e0811111-1111-4111-8111-111111111111',
  'da111111-1111-4111-8111-111111111111',
  'total-loss-package', 'professional-report'
);

insert into public.total_loss_claim_documents (
  id, case_id, document_kind, storage_bucket_id, storage_object_name,
  original_filename, media_type, byte_size, content_digest, status, sealed_at
)
values
  (
    'e0911111-1111-4111-8111-111111111111',
    'da111111-1111-4111-8111-111111111111',
    'professional-report', 'case-files',
    'd1111111-1111-4111-8111-111111111111/da111111-1111-4111-8111-111111111111/report.pdf',
    'venfour-report.pdf', 'application/pdf', 1000, repeat('d', 64),
    'ready', statement_timestamp()
  ),
  (
    'e0922222-2222-4222-8222-222222222222',
    'da111111-1111-4111-8111-111111111111',
    'insurer-message', null, null, null, null, null, null, 'pending', null
  );

insert into public.total_loss_report_versions (
  id, case_id, report_series_id, version_number, final_assessment_id,
  preliminary_snapshot_id, document_id, renderer_version, template_version,
  schema_version, report, report_digest, status, published_at
)
values
  (
    'e1011111-1111-4111-8111-111111111111',
    'da111111-1111-4111-8111-111111111111',
    'e0811111-1111-4111-8111-111111111111', 1,
    'e0711111-1111-4111-8111-111111111111',
    'df111111-1111-4111-8111-111111111111',
    'e0911111-1111-4111-8111-111111111111',
    '1', '1', '1', '{"title":"Professional report"}'::jsonb,
    repeat('e', 64), 'published', statement_timestamp()
  ),
  (
    'e1022222-2222-4222-8222-222222222222',
    'da111111-1111-4111-8111-111111111111',
    'e0811111-1111-4111-8111-111111111111', 2,
    'e0711111-1111-4111-8111-111111111111',
    'df111111-1111-4111-8111-111111111111', null,
    '1', '2', '1', '{"title":"Draft revision"}'::jsonb,
    repeat('f', 64), 'draft', null
  );

insert into public.total_loss_ai_review_runs (
  id, case_id, final_assessment_id, report_version_id,
  provider_identifier, model_identifier, prompt_version, schema_version,
  input_digest, output_digest, review_result, recommendation, confidence,
  status, started_at, completed_at
)
values (
  'e1111111-1111-4111-8111-111111111111',
  'da111111-1111-4111-8111-111111111111',
  'e0711111-1111-4111-8111-111111111111',
  'e1011111-1111-4111-8111-111111111111',
  'example', 'review-model', '1', '1', repeat('1', 64), repeat('2', 64),
  '{"issues":[]}'::jsonb, 'PASS', 'HIGH', 'completed',
  statement_timestamp() - interval '1 minute', statement_timestamp()
);

insert into public.total_loss_release_reviews (
  id, case_id, ai_review_run_id, status, assigned_staff_user_id,
  decision, rationale, resolved_by_user_id, resolved_at
)
values (
  'e1211111-1111-4111-8111-111111111111',
  'da111111-1111-4111-8111-111111111111',
  'e1111111-1111-4111-8111-111111111111', 'resolved',
  'd4444444-4444-4444-8444-444444444444',
  'approved', 'Evidence and limitations are supported.',
  'd4444444-4444-4444-8444-444444444444', statement_timestamp()
);

insert into public.total_loss_education_progress (
  case_id, report_version_id, step_identifier, viewed_at, completed_at
)
values (
  'da111111-1111-4111-8111-111111111111',
  'e1011111-1111-4111-8111-111111111111',
  'understand-valuation', statement_timestamp(), statement_timestamp()
);

insert into public.total_loss_negotiation_rounds (
  id, case_id, round_number, status
)
values (
  'e1311111-1111-4111-8111-111111111111',
  'da111111-1111-4111-8111-111111111111', 1, 'open'
);

insert into public.total_loss_message_drafts (
  id, case_id, negotiation_round_id, report_version_id,
  purpose, recipient, subject, body
)
values (
  'e1411111-1111-4111-8111-111111111111',
  'da111111-1111-4111-8111-111111111111',
  'e1311111-1111-4111-8111-111111111111',
  'e1011111-1111-4111-8111-111111111111',
  'initial-request', 'adjuster@example.test', 'Valuation review', 'Please review the attached evidence.'
);

insert into public.total_loss_message_versions (
  id, case_id, message_draft_id, negotiation_round_id, report_version_id,
  version_number, message_state, purpose, recipient, subject, body,
  message_digest
)
values (
  'e1511111-1111-4111-8111-111111111111',
  'da111111-1111-4111-8111-111111111111',
  'e1411111-1111-4111-8111-111111111111',
  'e1311111-1111-4111-8111-111111111111',
  'e1011111-1111-4111-8111-111111111111',
  1, 'prepared', 'initial-request', 'adjuster@example.test',
  'Valuation review', 'Please review the attached evidence.', repeat('3', 64)
);

insert into public.total_loss_communications (
  id, case_id, negotiation_round_id, direction, channel,
  communication_type, status, sender, recipient, subject, original_content
)
values
  (
    'e1611111-1111-4111-8111-111111111111',
    'da111111-1111-4111-8111-111111111111',
    'e1311111-1111-4111-8111-111111111111',
    'inbound', 'email', 'insurer-response', 'draft',
    'adjuster@example.test', 'foundation-owner@example.test',
    'Re: Valuation review', 'We can increase the offer.'
  ),
  (
    'e1622222-2222-4222-8222-222222222222',
    'da111111-1111-4111-8111-111111111111',
    'e1311111-1111-4111-8111-111111111111',
    'inbound', 'pasted_message', 'insurer-note', 'draft',
    null, null, null, 'Unconfirmed note.'
  );

insert into public.total_loss_communication_documents (
  case_id, communication_id, document_id
)
values (
  'da111111-1111-4111-8111-111111111111',
  'e1611111-1111-4111-8111-111111111111',
  'e0911111-1111-4111-8111-111111111111'
);

update public.total_loss_communications
set
  status = 'confirmed',
  occurred_at = statement_timestamp() - interval '1 hour',
  confirmed_at = statement_timestamp()
where id = 'e1611111-1111-4111-8111-111111111111';

insert into public.total_loss_fact_assertions (
  id, case_id, source_communication_id, fact_type, fact_value,
  extraction_method, confidence, status, confirmed_by_user_id, confirmed_at
)
values (
  'e1711111-1111-4111-8111-111111111111',
  'da111111-1111-4111-8111-111111111111',
  'e1611111-1111-4111-8111-111111111111',
  'insurer-offer', '{"amountMinorUnits":1900000,"currency":"USD"}'::jsonb,
  'human-entry', 1, 'confirmed',
  'd1111111-1111-4111-8111-111111111111', statement_timestamp()
);

insert into public.total_loss_offers (
  id, case_id, negotiation_round_id, source_communication_id,
  source_fact_assertion_id, amount_minor_units, currency, offer_kind,
  status, received_at, decided_at, decision_recorded_by_user_id
)
values (
  'e1811111-1111-4111-8111-111111111111',
  'da111111-1111-4111-8111-111111111111',
  'e1311111-1111-4111-8111-111111111111',
  'e1611111-1111-4111-8111-111111111111',
  'e1711111-1111-4111-8111-111111111111',
  1900000, 'USD', 'revised-valuation', 'accepted',
  statement_timestamp() - interval '1 hour', statement_timestamp(),
  'd1111111-1111-4111-8111-111111111111'
);

insert into public.total_loss_recommendations (
  id, case_id, negotiation_round_id, version_number, recommendation_type,
  recommendation, evidence_references, generation_method, status,
  recommendation_digest, published_at
)
values
  (
    'e1911111-1111-4111-8111-111111111111',
    'da111111-1111-4111-8111-111111111111',
    'e1311111-1111-4111-8111-111111111111', 1, 'review-offer',
    '{"summary":"Review the revised valuation."}'::jsonb,
    '[{"factId":"e1711111-1111-4111-8111-111111111111"}]'::jsonb,
    'deterministic', 'published', repeat('4', 64), statement_timestamp()
  ),
  (
    'e1922222-2222-4222-8222-222222222222',
    'da111111-1111-4111-8111-111111111111',
    'e1311111-1111-4111-8111-111111111111', 2, 'review-offer',
    '{"summary":"Draft follow-up."}'::jsonb, '[]'::jsonb,
    'deterministic', 'draft', repeat('5', 64), null
  );

insert into public.total_loss_workflow_events (
  id, case_id, event_type, actor_type, actor_user_id,
  associated_entity_type, associated_entity_id, client_request_id, details
)
values (
  'e2011111-1111-4111-8111-111111111111',
  'da111111-1111-4111-8111-111111111111',
  'workflow.created', 'customer',
  'd1111111-1111-4111-8111-111111111111',
  'workflow', 'da111111-1111-4111-8111-111111111111',
  'e2111111-1111-4111-8111-111111111111', '{"source":"continue"}'::jsonb
);

set local role authenticated;
set local request.jwt.claim.sub = 'd1111111-1111-4111-8111-111111111111';

select is(
  public.is_permanent_total_loss_case_owner(
    'da111111-1111-4111-8111-111111111111'
  ),
  true,
  'a permanent authenticated Total-Loss owner satisfies the owner predicate'
);

select is(
  (select count(*) from public.total_loss_claim_workflows),
  1::bigint,
  'the permanent owner can read only their workflow'
);

select is(
  (select count(*) from public.case_entitlements),
  1::bigint,
  'the permanent owner can read their entitlement without financial provider data'
);

select is(
  (select count(*) from public.total_loss_report_series),
  1::bigint,
  'the permanent owner can read their report series'
);

select is(
  (select count(*) from public.total_loss_claim_documents),
  1::bigint,
  'the permanent owner sees ready claim documents but not pending metadata'
);

select is(
  (select count(*) from public.total_loss_report_versions),
  1::bigint,
  'the permanent owner sees published reports but not drafts'
);

select is(
  (select count(*) from public.total_loss_education_progress),
  1::bigint,
  'the permanent owner can read their education progress'
);

select is(
  (select count(*) from public.total_loss_negotiation_rounds),
  1::bigint,
  'the permanent owner can read their negotiation rounds'
);

select is(
  (select count(*) from public.total_loss_message_drafts),
  1::bigint,
  'the permanent owner can read their current message draft'
);

select is(
  (select count(*) from public.total_loss_message_versions),
  1::bigint,
  'the permanent owner can read immutable prepared message versions'
);

select is(
  (select count(*) from public.total_loss_communications),
  1::bigint,
  'the permanent owner sees confirmed communications but not drafts'
);

select is(
  (select count(*) from public.total_loss_communication_documents),
  1::bigint,
  'the permanent owner sees attachments only for confirmed communications'
);

select is(
  (select count(*) from public.total_loss_fact_assertions),
  1::bigint,
  'the permanent owner sees confirmed facts'
);

select is(
  (select count(*) from public.total_loss_offers),
  1::bigint,
  'the permanent owner sees their recorded offers'
);

select is(
  (select count(*) from public.total_loss_recommendations),
  1::bigint,
  'the permanent owner sees published recommendations but not drafts'
);

select is(
  (select count(*) from public.total_loss_preliminary_snapshots),
  0::bigint,
  'owners cannot directly read raw preliminary snapshots'
);

select is(
  (select count(*) from public.total_loss_final_assessments),
  0::bigint,
  'owners cannot directly read raw final assessments'
);

select is(
  (select count(*) from public.total_loss_ai_review_runs),
  0::bigint,
  'owners cannot directly read raw AI reviews'
);

select is(
  (select count(*) from public.total_loss_release_reviews),
  0::bigint,
  'owners cannot directly read the human exception queue'
);

select throws_ok(
  $$select count(*) from public.commerce_orders$$,
  '42501',
  null,
  'owners have no direct financial-order surface'
);

select throws_ok(
  $$select count(*) from public.total_loss_package_jobs$$,
  '42501',
  null,
  'owners cannot read trusted package-job leases'
);

select throws_ok(
  $$select count(*) from public.total_loss_workflow_events$$,
  '42501',
  null,
  'owners cannot read the raw workflow event journal'
);

select throws_ok(
  $$
    insert into public.total_loss_workflow_events (
      case_id, event_type, actor_type, actor_user_id
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'browser.write',
      'customer',
      'd1111111-1111-4111-8111-111111111111'
    )
  $$,
  '42501',
  null,
  'the owner cannot author authoritative workflow events directly'
);

set local request.jwt.claim.sub = 'd2222222-2222-4222-8222-222222222222';

select is(
  public.is_permanent_total_loss_case_owner(
    'da111111-1111-4111-8111-111111111111'
  ),
  false,
  'a permanent but different customer fails the owner predicate'
);

select is(
  (
    (select count(*) from public.total_loss_claim_workflows)
    + (select count(*) from public.case_entitlements)
    + (select count(*) from public.total_loss_report_series)
    + (select count(*) from public.total_loss_claim_documents)
    + (select count(*) from public.total_loss_report_versions)
    + (select count(*) from public.total_loss_communications)
    + (select count(*) from public.total_loss_fact_assertions)
    + (select count(*) from public.total_loss_offers)
    + (select count(*) from public.total_loss_recommendations)
  ),
  0::bigint,
  'a wrong owner cannot read any customer post-Continue record'
);

set local request.jwt.claim.sub = 'd3333333-3333-4333-8333-333333333333';

select is(
  public.is_permanent_total_loss_case_owner(
    'da333333-3333-4333-8333-333333333333'
  ),
  false,
  'an authenticated anonymous owner is explicitly denied'
);

select is(
  (select count(*) from public.total_loss_claim_workflows),
  0::bigint,
  'an authenticated anonymous owner cannot read their own post-Continue workflow'
);

set local request.jwt.claim.sub = 'd4444444-4444-4444-8444-444444444444';

select is(
  array[
    (select count(*) from public.total_loss_preliminary_snapshots),
    (select count(*) from public.total_loss_final_assessments),
    (select count(*) from public.total_loss_claim_documents),
    (select count(*) from public.total_loss_report_versions),
    (select count(*) from public.total_loss_ai_review_runs),
    (select count(*) from public.total_loss_release_reviews)
  ],
  array[2, 1, 2, 2, 1, 1]::bigint[],
  'database-authorized staff can inspect only the release evidence surfaces'
);

select is(
  (
    (select count(*) from public.total_loss_claim_workflows)
    + (select count(*) from public.case_entitlements)
    + (select count(*) from public.total_loss_report_series)
    + (select count(*) from public.total_loss_communications)
    + (select count(*) from public.total_loss_offers)
  ),
  0::bigint,
  'staff membership does not imply customer-workspace ownership'
);

select throws_ok(
  $$
    update public.total_loss_release_reviews
    set due_at = statement_timestamp()
    where id = 'e1211111-1111-4111-8111-111111111111'
  $$,
  '42501',
  null,
  'staff has no direct exception-queue write authority'
);

reset role;
set local role anon;

select throws_ok(
  $$select count(*) from public.total_loss_claim_workflows$$,
  '42501',
  null,
  'the unauthenticated anon role has no post-Continue read surface'
);

reset role;

delete from public.total_loss_claim_workflows
where case_id = 'da333333-3333-4333-8333-333333333333';

select throws_ok(
  $$
    insert into public.total_loss_claim_workflows (
      case_id, preliminary_snapshot_id, phase, current_task
    ) values (
      'da222222-2222-4222-8222-222222222222',
      'df333333-3333-4333-8333-333333333333',
      'review',
      'review_result'
    )
  $$,
  '23503',
  null,
  'a workflow cannot consume a snapshot from another case'
);

select throws_ok(
  $$
    insert into public.total_loss_preliminary_snapshots (
      case_id, analysis_job_id, analysis_run_id, owner_user_id_at_snapshot,
      source_intake_mode, source_analysis_input_revision,
      source_analysis_input_id, preliminary_classification, currency,
      analysis_run_schema_version, analysis_version,
      discrepancy_analysis_version, comparable_scoring_version,
      presentation_schema_version, snapshot_schema_version,
      source_references, snapshot, snapshot_digest
    ) values (
      'da222222-2222-4222-8222-222222222222',
      'db333333-3333-4333-8333-333333333333',
      'dd333333-3333-4333-8333-333333333333',
      'd2222222-2222-4222-8222-222222222222',
      'manual', 1, 'de333333-3333-4333-8333-333333333333',
      'SUPPORTED', 'USD', '4', '4', '1', '1', '1', '1',
      '{}'::jsonb, '{}'::jsonb, repeat('6', 64)
    )
  $$,
  '23503',
  null,
  'a preliminary snapshot cannot cross analysis job and case identity'
);

select throws_ok(
  $$
    insert into public.total_loss_preliminary_snapshots (
      case_id, analysis_job_id, analysis_run_id, owner_user_id_at_snapshot,
      source_intake_mode, source_analysis_input_revision,
      source_analysis_input_id, preliminary_classification, currency,
      analysis_run_schema_version, analysis_version,
      discrepancy_analysis_version, comparable_scoring_version,
      presentation_schema_version, snapshot_schema_version,
      source_references, snapshot, snapshot_digest
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'db111111-1111-4111-8111-111111111111',
      'dd111111-1111-4111-8111-111111111111',
      'd1111111-1111-4111-8111-111111111111',
      'manual', 2, 'de111111-1111-4111-8111-111111111111',
      'SUPPORTED', 'USD', '4', '4', '1', '1', '1', '1',
      '{}'::jsonb, '{}'::jsonb, repeat('7', 64)
    )
  $$,
  '23514',
  'Preliminary snapshot source identity must match its analysis job.',
  'a preliminary snapshot must preserve the exact analysis-job source identity'
);

select throws_ok(
  $$
    insert into public.commerce_orders (
      case_id, purchaser_user_id, preliminary_snapshot_id,
      product_identifier, product_version, amount_minor_units, currency,
      terms_version, refund_policy_version
    ) values (
      'da222222-2222-4222-8222-222222222222',
      'd2222222-2222-4222-8222-222222222222',
      'df111111-1111-4111-8111-111111111111',
      'cross-case', '1', 9900, 'USD', '1', '1'
    )
  $$,
  '23503',
  null,
  'an order cannot cross its case and preliminary snapshot'
);

update public.checkout_attempts
set status = 'expired', finished_at = statement_timestamp()
where id = 'e0211111-1111-4111-8111-111111111111';

select throws_ok(
  $$
    insert into public.checkout_attempts (
      case_id, order_id, client_request_id, payment_provider,
      status, amount_minor_units, currency
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e0111111-1111-4111-8111-111111111111',
      gen_random_uuid(), 'stripe', 'creating', 9800, 'USD'
    )
  $$,
  '23503',
  null,
  'a checkout attempt must preserve its order amount and currency snapshot'
);

select throws_ok(
  $$
    insert into public.checkout_attempts (
      case_id, order_id, client_request_id, payment_provider,
      status, amount_minor_units, currency
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e0111111-1111-4111-8111-111111111111',
      'e0311111-1111-4111-8111-111111111111',
      'stripe', 'creating', 9900, 'USD'
    )
  $$,
  '23505',
  null,
  'checkout creation is idempotent per order and client request'
);

insert into public.checkout_attempts (
  id, case_id, order_id, client_request_id, payment_provider,
  status, amount_minor_units, currency
)
values (
  'e0222222-2222-4222-8222-222222222222',
  'da111111-1111-4111-8111-111111111111',
  'e0111111-1111-4111-8111-111111111111',
  'e0322222-2222-4222-8222-222222222222',
  'stripe', 'creating', 9900, 'USD'
);

select throws_ok(
  $$
    insert into public.checkout_attempts (
      case_id, order_id, client_request_id, payment_provider,
      status, amount_minor_units, currency
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e0111111-1111-4111-8111-111111111111',
      gen_random_uuid(), 'stripe', 'creating', 9900, 'USD'
    )
  $$,
  '23505',
  null,
  'only one creating or open checkout attempt may exist per order'
);

select throws_ok(
  $$
    insert into public.payment_transactions (
      case_id, order_id, payment_provider, transaction_kind,
      external_object_id, amount_minor_units, currency, provider_occurred_at
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e0111111-1111-4111-8111-111111111111',
      'stripe', 'payment', 'pi_foundation_1', 9900, 'USD', statement_timestamp()
    )
  $$,
  '23505',
  null,
  'provider payment objects cannot be recorded twice'
);

select throws_ok(
  $$
    insert into public.payment_transactions (
      case_id, order_id, payment_provider, transaction_kind,
      external_object_id, amount_minor_units, currency, provider_occurred_at
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e0111111-1111-4111-8111-111111111111',
      'stripe', 'refund', 're_currency_mismatch', 1000, 'EUR',
      statement_timestamp()
    )
  $$,
  '23503',
  null,
  'financial transactions must use the order currency'
);

select throws_ok(
  $$
    insert into public.payment_transactions (
      id, case_id, order_id, related_transaction_id, payment_provider,
      transaction_kind, external_object_id, amount_minor_units, currency,
      provider_occurred_at
    ) values (
      'e0422222-2222-4222-8222-222222222222',
      'da111111-1111-4111-8111-111111111111',
      'e0111111-1111-4111-8111-111111111111',
      'e0422222-2222-4222-8222-222222222222',
      'stripe', 'refund', 're_self_relation', 1000, 'USD',
      statement_timestamp()
    )
  $$,
  '23514',
  null,
  'financial transactions cannot relate to themselves'
);

select throws_ok(
  $$
    insert into public.payment_transactions (
      case_id, order_id, checkout_attempt_id, payment_provider,
      transaction_kind, external_object_id, amount_minor_units, currency,
      provider_occurred_at
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e0111111-1111-4111-8111-111111111111',
      'e0211111-1111-4111-8111-111111111111',
      'other_provider', 'payment', 'pi_provider_mismatch', 9900, 'USD',
      statement_timestamp()
    )
  $$,
  '23503',
  null,
  'financial transactions must match their checkout provider identity'
);

insert into public.commerce_orders (
  id, case_id, purchaser_user_id, preliminary_snapshot_id,
  product_identifier, product_version, amount_minor_units, currency,
  status, terms_version, refund_policy_version
)
values (
  'e0122222-2222-4222-8222-222222222222',
  'da111111-1111-4111-8111-111111111111',
  'd1111111-1111-4111-8111-111111111111',
  'df111111-1111-4111-8111-111111111111',
  'total-loss-package', '2', 10900, 'USD', 'pending', '2', '2'
);

select throws_ok(
  $$
    insert into public.payment_transactions (
      case_id, order_id, related_transaction_id, payment_provider,
      transaction_kind, external_object_id, amount_minor_units, currency,
      provider_occurred_at
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e0122222-2222-4222-8222-222222222222',
      'e0411111-1111-4111-8111-111111111111',
      'stripe', 'refund', 're_cross_order', 1000, 'USD',
      statement_timestamp()
    )
  $$,
  '23503',
  null,
  'financial transaction lineage cannot cross logical orders'
);

select throws_ok(
  $$
    insert into public.case_entitlements (
      case_id, order_id, preliminary_snapshot_id,
      product_identifier, product_version, status
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e0122222-2222-4222-8222-222222222222',
      'df111111-1111-4111-8111-111111111111',
      'total-loss-package', '2', 'active'
    )
  $$,
  '23505',
  null,
  'one non-revoked entitlement is enforced per case and product across versions'
);

select throws_ok(
  $$
    insert into public.case_entitlements (
      case_id, order_id, preliminary_snapshot_id,
      product_identifier, product_version, status
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e0122222-2222-4222-8222-222222222222',
      'df111111-1111-4111-8111-111111111111',
      'different-product', '2', 'active'
    )
  $$,
  '23503',
  null,
  'an entitlement must exactly match its order product identity'
);

select throws_ok(
  $$
    insert into public.total_loss_package_jobs (
      case_id, entitlement_id, preliminary_snapshot_id, status
    ) values (
      'da333333-3333-4333-8333-333333333333',
      'e0511111-1111-4111-8111-111111111111',
      'df333333-3333-4333-8333-333333333333',
      'queued'
    )
  $$,
  '23503',
  null,
  'a package job cannot cross entitlement and case identity'
);

select throws_ok(
  $$
    insert into public.total_loss_package_jobs (
      case_id, entitlement_id, preliminary_snapshot_id, status,
      attempt_count, processing_token, processing_expires_at,
      started_at, finished_at
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e0511111-1111-4111-8111-111111111111',
      'df111111-1111-4111-8111-111111111111',
      'ready', 1, null, null, statement_timestamp(), statement_timestamp()
    )
  $$,
  '23514',
  null,
  'a terminal package job retains its idempotency token'
);

select throws_ok(
  $$
    insert into public.total_loss_final_assessments (
      case_id, package_job_id, preliminary_snapshot_id, version_number,
      conclusion_code, currency, findings, limitations, reason_codes,
      preliminary_to_final_comparison, assessment, methodology_version,
      schema_version, assessment_digest
    ) values (
      'da333333-3333-4333-8333-333333333333',
      'e0611111-1111-4111-8111-111111111111',
      'df333333-3333-4333-8333-333333333333', 1,
      'SUPPORTED', 'USD', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      '{}'::jsonb, '{}'::jsonb, '1', '1', repeat('7', 64)
    )
  $$,
  '23503',
  null,
  'a final assessment cannot cross its job, snapshot, and case'
);

select throws_ok(
  $$
    insert into public.total_loss_final_assessments (
      case_id, package_job_id, preliminary_snapshot_id, version_number,
      conclusion_code, currency, findings, limitations, reason_codes,
      preliminary_to_final_comparison, assessment, methodology_version,
      schema_version, assessment_digest
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e0611111-1111-4111-8111-111111111111',
      'df111111-1111-4111-8111-111111111111', 1,
      'SUPPORTED', 'USD', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      '{}'::jsonb, '{}'::jsonb, '1', '1', repeat('8', 64)
    )
  $$,
  '23505',
  null,
  'final assessments are uniquely versioned per case and snapshot'
);

select throws_ok(
  $$
    insert into public.total_loss_report_series (
      case_id, product_identifier, report_kind
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'total-loss-package', 'professional-report'
    )
  $$,
  '23505',
  null,
  'one logical report series exists per case, product, and kind'
);

select throws_ok(
  $$
    insert into public.total_loss_report_versions (
      case_id, report_series_id, version_number, final_assessment_id,
      preliminary_snapshot_id, renderer_version, template_version,
      schema_version, report, report_digest, status
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e0811111-1111-4111-8111-111111111111', 2,
      'e0711111-1111-4111-8111-111111111111',
      'df111111-1111-4111-8111-111111111111',
      '1', '3', '1', '{}'::jsonb, repeat('9', 64), 'draft'
    )
  $$,
  '23505',
  null,
  'report version numbers are unique within a series'
);

select throws_ok(
  $$
    insert into public.total_loss_education_progress (
      case_id, report_version_id, step_identifier, completed_at
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e1011111-1111-4111-8111-111111111111',
      'invalid-progress', statement_timestamp()
    )
  $$,
  '23514',
  null,
  'education completion cannot precede viewing'
);

select throws_ok(
  $$
    insert into public.total_loss_negotiation_rounds (
      case_id, round_number, status
    ) values (
      'da111111-1111-4111-8111-111111111111', 2, 'waiting_for_insurer'
    )
  $$,
  '23505',
  null,
  'only one non-closed negotiation round may exist per case'
);

select throws_ok(
  $$
    insert into public.total_loss_message_drafts (
      case_id, negotiation_round_id, purpose, subject, body
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e1311111-1111-4111-8111-111111111111',
      'initial-request', 'Duplicate', 'Duplicate'
    )
  $$,
  '23505',
  null,
  'one current message draft exists per case, purpose, and round'
);

select throws_ok(
  $$
    insert into public.total_loss_message_versions (
      case_id, message_draft_id, negotiation_round_id, version_number,
      message_state, purpose, recipient, subject, body, message_digest
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e1411111-1111-4111-8111-111111111111',
      'e1311111-1111-4111-8111-111111111111', 1,
      'prepared', 'initial-request', 'adjuster@example.test',
      'Duplicate', 'Duplicate', repeat('a', 64)
    )
  $$,
  '23505',
  null,
  'message version numbers are unique per draft'
);

select throws_ok(
  $$
    insert into public.total_loss_communications (
      case_id, negotiation_round_id, direction, channel,
      communication_type, status, original_content
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e1311111-1111-4111-8111-111111111111',
      'outbound', 'email', 'follow-up', 'draft', 'Missing exact message version.'
    )
  $$,
  '23514',
  null,
  'outbound email communications require an exact message version'
);

select throws_ok(
  $$
    insert into public.total_loss_communication_documents (
      case_id, communication_id, document_id
    ) values (
      'da333333-3333-4333-8333-333333333333',
      'e1622222-2222-4222-8222-222222222222',
      'e0922222-2222-4222-8222-222222222222'
    )
  $$,
  '23503',
  null,
  'communication attachments cannot cross their case identity'
);

select throws_ok(
  $$
    insert into public.total_loss_fact_assertions (
      case_id, source_communication_id, source_document_id,
      fact_type, fact_value, extraction_method
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e1622222-2222-4222-8222-222222222222',
      'e0922222-2222-4222-8222-222222222222',
      'ambiguous-source', 'true'::jsonb, 'human-entry'
    )
  $$,
  '23514',
  null,
  'a fact assertion requires exactly one authoritative source'
);

select throws_ok(
  $$
    insert into public.total_loss_offers (
      case_id, negotiation_round_id, source_communication_id,
      amount_minor_units, currency, offer_kind, received_at
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e1311111-1111-4111-8111-111111111111',
      'e1611111-1111-4111-8111-111111111111',
      0, 'USD', 'invalid-offer', statement_timestamp()
    )
  $$,
  '23514',
  null,
  'offers require positive integer minor units'
);

select throws_ok(
  $$
    insert into public.total_loss_recommendations (
      case_id, negotiation_round_id, version_number, recommendation_type,
      recommendation, evidence_references, generation_method,
      status, recommendation_digest
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e1311111-1111-4111-8111-111111111111', 2, 'review-offer',
      '{}'::jsonb, '[]'::jsonb, 'deterministic', 'draft', repeat('b', 64)
    )
  $$,
  '23505',
  null,
  'recommendations are uniquely versioned per negotiation round'
);

select throws_ok(
  $$
    insert into public.total_loss_workflow_events (
      case_id, event_type, actor_type, client_request_id
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'workflow.retry', 'system',
      'e2111111-1111-4111-8111-111111111111'
    )
  $$,
  '23505',
  null,
  'workflow events are idempotent per case and client request'
);

select throws_ok(
  $$
    insert into public.commerce_orders (
      case_id, purchaser_user_id, preliminary_snapshot_id,
      product_identifier, product_version, amount_minor_units, currency,
      status, terms_version, refund_policy_version
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'd1111111-1111-4111-8111-111111111111',
      'df111111-1111-4111-8111-111111111111',
      'invalid-paid-order', '1', 9900, 'USD', 'paid', '1', '1'
    )
  $$,
  '23514',
  null,
  'paid commerce state requires its paid timestamp'
);

select throws_ok(
  $$
    insert into public.total_loss_claim_documents (
      case_id, document_kind, status, sealed_at
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'invalid-ready', 'ready', statement_timestamp()
    )
  $$,
  '23514',
  null,
  'ready documents require complete storage and content metadata'
);

select throws_ok(
  $$
    insert into public.total_loss_report_versions (
      case_id, report_series_id, version_number, final_assessment_id,
      preliminary_snapshot_id, renderer_version, template_version,
      schema_version, report, report_digest, status, published_at
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e0811111-1111-4111-8111-111111111111', 3,
      'e0711111-1111-4111-8111-111111111111',
      'df111111-1111-4111-8111-111111111111',
      '1', '3', '1', '{}'::jsonb, repeat('c', 64),
      'published', statement_timestamp()
    )
  $$,
  '23514',
  null,
  'published report versions require a generated document'
);

select throws_ok(
  $$
    insert into public.total_loss_report_versions (
      case_id, report_series_id, version_number, final_assessment_id,
      preliminary_snapshot_id, document_id, renderer_version,
      template_version, schema_version, report, report_digest, status,
      published_at
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e0811111-1111-4111-8111-111111111111', 3,
      'e0711111-1111-4111-8111-111111111111',
      'df111111-1111-4111-8111-111111111111',
      'e0922222-2222-4222-8222-222222222222',
      '1', '3', '1', '{}'::jsonb, repeat('c', 64),
      'published', statement_timestamp()
    )
  $$,
  '23514',
  'Published reports require a ready sealed document.',
  'published report versions reject pending document metadata'
);

select throws_ok(
  $test$
    do $body$
    begin
      insert into public.total_loss_analysis_jobs (
        id, case_id, source_report_upload_id, source_details_updated_at,
        status, attempt_count, processing_token, processing_expires_at,
        run_id, failure_code, retryable, finished_at, source_intake_mode,
        source_analysis_input_revision, source_analysis_input_id
      ) values (
        'db122222-2222-4222-8222-222222222222',
        'da111111-1111-4111-8111-111111111111', null,
        '2026-08-25 02:00:00+00', 'completed', 1,
        'dc122222-2222-4222-8222-222222222222', null,
        'dd122222-2222-4222-8222-222222222222', null, null,
        '2026-08-25 02:01:00+00', 'manual', 2,
        'de122222-2222-4222-8222-222222222222'
      );

      insert into public.analysis_runs (
        id, job_id, case_id, artifact, request_digest,
        analysis_run_schema_version, analysis_version,
        discrepancy_analysis_version, comparable_scoring_version
      ) values (
        'dd122222-2222-4222-8222-222222222222',
        'db122222-2222-4222-8222-222222222222',
        'da111111-1111-4111-8111-111111111111',
        '{"runId":"dd122222-2222-4222-8222-222222222222"}'::jsonb,
        repeat('8', 64), '4', '4', '1', '1'
      );

      insert into public.total_loss_preliminary_snapshots (
        id, case_id, analysis_job_id, analysis_run_id,
        owner_user_id_at_snapshot, source_intake_mode,
        source_analysis_input_revision, source_analysis_input_id,
        preliminary_classification, currency, analysis_run_schema_version,
        analysis_version, discrepancy_analysis_version,
        comparable_scoring_version, presentation_schema_version,
        snapshot_schema_version, source_references, snapshot, snapshot_digest
      ) values (
        'df122222-2222-4222-8222-222222222222',
        'da111111-1111-4111-8111-111111111111',
        'db122222-2222-4222-8222-222222222222',
        'dd122222-2222-4222-8222-222222222222',
        'd1111111-1111-4111-8111-111111111111', 'manual', 2,
        'de122222-2222-4222-8222-222222222222', 'SUPPORTED', 'USD',
        '4', '4', '1', '1', '1', '1', '{}'::jsonb, '{}'::jsonb,
        repeat('9', 64)
      );

      insert into public.total_loss_report_versions (
        case_id, report_series_id, version_number, final_assessment_id,
        preliminary_snapshot_id, renderer_version, template_version,
        schema_version, report, report_digest, status
      ) values (
        'da111111-1111-4111-8111-111111111111',
        'e0811111-1111-4111-8111-111111111111', 3,
        'e0711111-1111-4111-8111-111111111111',
        'df122222-2222-4222-8222-222222222222',
        '1', '3', '1', '{}'::jsonb, repeat('a', 64), 'draft'
      );
    end;
    $body$
  $test$,
  '23503',
  null,
  'a report and final assessment must reference the same preliminary snapshot'
);

select throws_ok(
  $$
    insert into public.total_loss_ai_review_runs (
      case_id, final_assessment_id, provider_identifier, model_identifier,
      prompt_version, schema_version, input_digest, status,
      started_at, completed_at
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e0711111-1111-4111-8111-111111111111',
      'example', 'review-model', '1', '1', repeat('d', 64),
      'completed', statement_timestamp(), statement_timestamp()
    )
  $$,
  '23514',
  null,
  'completed AI review state requires structured output and a decision'
);

select throws_ok(
  $$
    insert into public.total_loss_release_reviews (
      case_id, ai_review_run_id, status
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'e1111111-1111-4111-8111-111111111111',
      'queued'
    )
  $$,
  '23505',
  null,
  'an AI review can enter the human exception queue only once'
);

select throws_ok(
  $$
    insert into public.total_loss_preliminary_snapshots (
      case_id, analysis_job_id, analysis_run_id, owner_user_id_at_snapshot,
      source_intake_mode, source_analysis_input_revision,
      source_analysis_input_id, preliminary_classification,
      supported_range_low_minor_units, supported_range_median_minor_units,
      supported_range_high_minor_units, currency,
      analysis_run_schema_version, analysis_version,
      discrepancy_analysis_version, comparable_scoring_version,
      presentation_schema_version, snapshot_schema_version,
      source_references, snapshot, snapshot_digest
    ) values (
      'da111111-1111-4111-8111-111111111111',
      'db111111-1111-4111-8111-111111111111',
      'dd111111-1111-4111-8111-111111111111',
      'd1111111-1111-4111-8111-111111111111',
      'manual', 1, 'de111111-1111-4111-8111-111111111111',
      'INVALID_RANGE', 2200000, 2100000, 2000000, 'USD',
      '4', '4', '1', '1', '1', '1', '{}'::jsonb, '{}'::jsonb,
      repeat('e', 64)
    )
  $$,
  '23514',
  null,
  'preliminary supported ranges must be complete and ordered'
);

select throws_ok(
  $$
    update public.total_loss_preliminary_snapshots
    set preliminary_classification = 'CHANGED'
    where id = 'df111111-1111-4111-8111-111111111111'
  $$,
  '55000',
  'total_loss_preliminary_snapshots records are immutable.',
  'preliminary snapshots reject updates'
);

select throws_ok(
  $$
    delete from public.total_loss_preliminary_snapshots
    where id = 'df111111-1111-4111-8111-111111111111'
  $$,
  '55000',
  'total_loss_preliminary_snapshots records are immutable.',
  'preliminary snapshots reject deletion'
);

set local role service_role;

select throws_ok(
  $$
    update public.payment_transactions
    set amount_minor_units = 1
    where id = 'e0411111-1111-4111-8111-111111111111'
  $$,
  '42501',
  null,
  'immutable financial movements have no service UPDATE grant'
);

select throws_ok(
  $$
    update public.total_loss_final_assessments
    set conclusion_code = 'CHANGED'
    where id = 'e0711111-1111-4111-8111-111111111111'
  $$,
  '42501',
  null,
  'immutable final assessments have no service UPDATE grant'
);

select throws_ok(
  $$
    update public.total_loss_message_versions
    set body = 'Changed'
    where id = 'e1511111-1111-4111-8111-111111111111'
  $$,
  '42501',
  null,
  'immutable prepared messages have no service UPDATE grant'
);

select throws_ok(
  $$
    delete from public.total_loss_workflow_events
    where id = 'e2011111-1111-4111-8111-111111111111'
  $$,
  '42501',
  null,
  'append-only workflow events have no service DELETE grant'
);

select throws_ok(
  $$
    update public.total_loss_report_versions
    set report = '{"changed":true}'::jsonb
    where id = 'e1011111-1111-4111-8111-111111111111'
  $$,
  '55000',
  'Terminal total_loss_report_versions records are immutable.',
  'published reports reject mutation'
);

select throws_ok(
  $$
    update public.total_loss_claim_documents
    set original_filename = 'changed.pdf'
    where id = 'e0911111-1111-4111-8111-111111111111'
  $$,
  '55000',
  'Terminal total_loss_claim_documents records are immutable.',
  'ready document metadata rejects mutation'
);

select throws_ok(
  $$
    update public.total_loss_ai_review_runs
    set confidence = 'LOW'
    where id = 'e1111111-1111-4111-8111-111111111111'
  $$,
  '55000',
  'Terminal AI review runs are immutable.',
  'terminal AI review output rejects mutation'
);

select throws_ok(
  $$
    update public.total_loss_release_reviews
    set rationale = 'Changed rationale.'
    where id = 'e1211111-1111-4111-8111-111111111111'
  $$,
  '55000',
  'Terminal total_loss_release_reviews records are immutable.',
  'resolved human release decisions reject mutation'
);

select throws_ok(
  $$
    update public.total_loss_communications
    set original_content = 'Changed response.'
    where id = 'e1611111-1111-4111-8111-111111111111'
  $$,
  '55000',
  'Terminal total_loss_communications records are immutable.',
  'confirmed communications reject mutation'
);

select throws_ok(
  $$
    update public.total_loss_communication_documents
    set display_order = 2
    where communication_id = 'e1611111-1111-4111-8111-111111111111'
  $$,
  '55000',
  'Confirmed communication attachments are immutable.',
  'attachments freeze with their confirmed communication'
);

select throws_ok(
  $$
    update public.total_loss_communication_documents
    set communication_id = 'e1622222-2222-4222-8222-222222222222'
    where communication_id = 'e1611111-1111-4111-8111-111111111111'
  $$,
  '55000',
  'Confirmed communication attachments are immutable.',
  'a confirmed attachment cannot be moved onto a mutable communication'
);

select throws_ok(
  $$
    update public.total_loss_fact_assertions
    set confidence = 0.5
    where id = 'e1711111-1111-4111-8111-111111111111'
  $$,
  '55000',
  'Terminal total_loss_fact_assertions records are immutable.',
  'confirmed facts reject mutation'
);

select throws_ok(
  $$
    update public.total_loss_offers
    set status = 'rejected'
    where id = 'e1811111-1111-4111-8111-111111111111'
  $$,
  '55000',
  'Terminal total_loss_offers records are immutable.',
  'decided offers reject mutation'
);

select throws_ok(
  $$
    update public.total_loss_recommendations
    set recommendation = '{"changed":true}'::jsonb
    where id = 'e1911111-1111-4111-8111-111111111111'
  $$,
  '55000',
  'Terminal total_loss_recommendations records are immutable.',
  'published recommendations reject mutation'
);

select throws_ok(
  $$
    update public.total_loss_claim_workflows
    set current_task = 'next_task'
    where case_id = 'da111111-1111-4111-8111-111111111111'
  $$,
  '40001',
  'total_loss_claim_workflows revision must advance by exactly one.',
  'workflow updates require an exact optimistic revision increment'
);

select lives_ok(
  $$
    update public.total_loss_claim_workflows
    set current_task = 'next_task', revision = revision + 1
    where case_id = 'da111111-1111-4111-8111-111111111111'
  $$,
  'workflow state can advance with the expected revision fence'
);

select throws_ok(
  $$
    update public.total_loss_claim_workflows
    set preliminary_snapshot_id = 'df333333-3333-4333-8333-333333333333',
        revision = revision + 1
    where case_id = 'da111111-1111-4111-8111-111111111111'
  $$,
  '55000',
  'total_loss_claim_workflows.preliminary_snapshot_id is immutable.',
  'mutable workflow rows cannot change stable source identity'
);

select throws_ok(
  $$
    update public.total_loss_message_drafts
    set body = 'Changed without revision.'
    where id = 'e1411111-1111-4111-8111-111111111111'
  $$,
  '40001',
  'total_loss_message_drafts revision must advance by exactly one.',
  'message drafts require optimistic revision advancement'
);

select lives_ok(
  $$
    update public.total_loss_message_drafts
    set body = 'Changed with revision.', revision = revision + 1
    where id = 'e1411111-1111-4111-8111-111111111111'
  $$,
  'message drafts remain mutable with the required revision fence'
);

insert into public.total_loss_ai_review_runs (
  id, case_id, final_assessment_id, provider_identifier, model_identifier,
  prompt_version, schema_version, input_digest, status
)
values (
  'e1122222-2222-4222-8222-222222222222',
  'da111111-1111-4111-8111-111111111111',
  'e0711111-1111-4111-8111-111111111111',
  'example', 'review-model', '1', '1', repeat('f', 64), 'queued'
);

select lives_ok(
  $$
    update public.total_loss_ai_review_runs
    set status = 'processing', started_at = statement_timestamp()
    where id = 'e1122222-2222-4222-8222-222222222222'
  $$,
  'queued AI reviews may begin processing without rewriting their input identity'
);

select throws_ok(
  $$
    update public.total_loss_ai_review_runs
    set model_identifier = 'different-model'
    where id = 'e1122222-2222-4222-8222-222222222222'
  $$,
  '55000',
  'AI review input identity is immutable.',
  'in-flight AI reviews cannot change model or input identity'
);

select lives_ok(
  $$
    update public.total_loss_claim_documents
    set status = 'failed', failure_code = 'GENERATION_FAILED'
    where id = 'e0922222-2222-4222-8222-222222222222'
  $$,
  'pending document metadata may transition to a terminal failure'
);

select throws_ok(
  $$
    update public.total_loss_claim_documents
    set failure_code = 'DIFFERENT_FAILURE'
    where id = 'e0922222-2222-4222-8222-222222222222'
  $$,
  '55000',
  'Terminal total_loss_claim_documents records are immutable.',
  'failed document metadata freezes after terminalization'
);

select lives_ok(
  $$
    update public.total_loss_negotiation_rounds
    set status = 'closed', closed_at = statement_timestamp(), revision = revision + 1
    where id = 'e1311111-1111-4111-8111-111111111111'
  $$,
  'an open negotiation round may close with an exact revision increment'
);

select throws_ok(
  $$
    update public.total_loss_negotiation_rounds
    set revision = revision + 1
    where id = 'e1311111-1111-4111-8111-111111111111'
  $$,
  '55000',
  'Terminal total_loss_negotiation_rounds records are immutable.',
  'closed negotiation rounds reject later mutation'
);

reset role;

select ok(
  position(
    'claim_phase' in pg_get_function_result(
      'public.list_owned_case_operations()'::regprocedure
    )
  ) = 0
    and position(
      'entitlement' in pg_get_function_result(
        'public.list_owned_case_operations()'::regprocedure
      )
    ) = 0
    and position(
      'current_task' in pg_get_function_result(
        'public.list_owned_case_operations()'::regprocedure
      )
    ) = 0,
  'the existing owned-case operation RPC exposes no new workflow contract'
);

select ok(
  not exists (
    select 1
    from information_schema.columns as column_record
    where column_record.table_schema = 'public'
      and column_record.table_name = 'appraisal_cases'
      and column_record.column_name in (
        'claim_phase',
        'current_task',
        'entitlement_id',
        'payment_provider',
        'current_offer_id'
      )
  ),
  'post-Continue state does not leak into the existing appraisal case record'
);

select * from finish();
rollback;
