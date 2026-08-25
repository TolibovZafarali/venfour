begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local storage.allow_delete_query = 'true';

select plan(96);

select has_table('public', 'staff_members', 'staff membership table exists');

select ok(
  (
    select relation.relrowsecurity
    from pg_class as relation
    where relation.oid = 'public.staff_members'::regclass
  ),
  'staff membership has row-level security enabled'
);

select col_is_pk(
  'public',
  'staff_members',
  'user_id',
  'staff membership is unique by auth user'
);

select fk_ok(
  'public',
  'staff_members',
  'user_id',
  'auth',
  'users',
  'id',
  'staff membership references an auth identity'
);

select ok(
  (
    select foreign_key.confdeltype = 'c'
    from pg_constraint as foreign_key
    where foreign_key.conrelid = 'public.staff_members'::regclass
      and foreign_key.contype = 'f'
      and foreign_key.conname = 'staff_members_user_id_fkey'
  ),
  'staff membership is removed when its auth identity is deleted'
);

select has_index(
  'public',
  'diminished_value_case_details',
  'diminished_value_case_details_submitted_queue_idx',
  'submitted diminished-value cases have a newest-first queue index'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 's'
      and 'search_path=""' = any(procedure.proconfig)
    from pg_proc as procedure
    where procedure.oid = 'public.is_venfour_staff()'::regprocedure
  ),
  'the staff membership check is stable, search-path-pinned, and SECURITY DEFINER'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 's'
      and 'search_path=""' = any(procedure.proconfig)
    from pg_proc as procedure
    where procedure.oid =
      'public.authorize_staff_diminished_value_document_read(text)'::regprocedure
  ),
  'staff document authorization is stable, search-path-pinned, and SECURITY DEFINER'
);

select ok(
  (
    select not procedure.prosecdef
      and procedure.proretset
      and procedure.provolatile = 's'
      and 'search_path=""' = any(procedure.proconfig)
    from pg_proc as procedure
    where procedure.oid =
      'public.list_submitted_diminished_value_cases()'::regprocedure
  ),
  'the staff queue RPC is a stable search-path-pinned SECURITY INVOKER set function'
);

select ok(
  (
    select not procedure.prosecdef
      and procedure.proretset
      and procedure.provolatile = 's'
      and 'search_path=""' = any(procedure.proconfig)
    from pg_proc as procedure
    where procedure.oid =
      'public.get_submitted_diminished_value_case(uuid)'::regprocedure
  ),
  'the staff detail RPC is a stable search-path-pinned SECURITY INVOKER set function'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as function_acl
    where procedure.oid in (
      'public.is_venfour_staff()'::regprocedure,
      'public.authorize_staff_diminished_value_document_read(text)'::regprocedure,
      'public.list_submitted_diminished_value_cases()'::regprocedure,
      'public.get_submitted_diminished_value_case(uuid)'::regprocedure
    )
      and function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute any staff function'
);

select ok(
  not has_function_privilege('anon', 'public.is_venfour_staff()', 'EXECUTE')
    and not has_function_privilege(
      'anon',
      'public.authorize_staff_diminished_value_document_read(text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.list_submitted_diminished_value_cases()',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.get_submitted_diminished_value_case(uuid)',
      'EXECUTE'
    ),
  'anonymous clients cannot execute staff functions'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.is_venfour_staff()',
    'EXECUTE'
  )
    and has_function_privilege(
      'authenticated',
      'public.authorize_staff_diminished_value_document_read(text)',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.list_submitted_diminished_value_cases()',
      'EXECUTE'
    )
    and has_function_privilege(
      'authenticated',
      'public.get_submitted_diminished_value_case(uuid)',
      'EXECUTE'
    ),
  'authenticated clients receive the staff check and read-only review RPC surface'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.is_venfour_staff()',
    'EXECUTE'
  )
    and not has_function_privilege(
      'service_role',
      'public.authorize_staff_diminished_value_document_read(text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.list_submitted_diminished_value_cases()',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.get_submitted_diminished_value_case(uuid)',
      'EXECUTE'
    ),
  'service credentials cannot impersonate the browser staff review surface'
);

select ok(
  not exists (
    select 1
    from pg_class as relation
    cross join lateral aclexplode(
      coalesce(relation.relacl, acldefault('r', relation.relowner))
    ) as table_acl
    where relation.oid = 'public.staff_members'::regclass
      and table_acl.grantee = 0
  )
    and not has_table_privilege('anon', 'public.staff_members', 'SELECT')
    and not has_table_privilege('anon', 'public.staff_members', 'INSERT')
    and not has_table_privilege('anon', 'public.staff_members', 'DELETE'),
  'PUBLIC and anonymous clients have no staff membership table surface'
);

select ok(
  not has_table_privilege('authenticated', 'public.staff_members', 'SELECT')
    and not has_table_privilege('authenticated', 'public.staff_members', 'INSERT')
    and not has_table_privilege('authenticated', 'public.staff_members', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.staff_members', 'DELETE'),
  'authenticated clients cannot inspect or mutate staff membership'
);

select ok(
  has_table_privilege('service_role', 'public.staff_members', 'SELECT')
    and has_table_privilege('service_role', 'public.staff_members', 'INSERT')
    and not has_table_privilege('service_role', 'public.staff_members', 'UPDATE')
    and has_table_privilege('service_role', 'public.staff_members', 'DELETE'),
  'the service role receives only the grant, inspect, and revoke membership operations'
);

select results_eq(
  $$
    select jsonb_build_array(
      policy.schemaname,
      policy.tablename,
      policy.policyname,
      policy.cmd,
      to_jsonb(policy.roles)
    ) as policy_tuple
    from pg_policies as policy
    where policy.policyname like 'Staff can %'
    order by policy.schemaname, policy.tablename, policy.policyname
  $$,
  $$
    values
      ('["public","appraisal_cases","Staff can read submitted diminished-value cases","SELECT",["authenticated"]]'::jsonb),
      ('["public","diminished_value_case_details","Staff can read submitted diminished-value details","SELECT",["authenticated"]]'::jsonb),
      ('["storage","objects","Staff can read submitted diminished-value documents","SELECT",["authenticated"]]'::jsonb)
  $$,
  'the staff policy catalog contains only the exact intended SELECT tuples'
);

select ok(
  not exists (
    select 1
    from pg_policies as policy
    where policy.policyname like 'Staff can %'
      and policy.cmd <> 'SELECT'
  ),
  'staff authorization adds no insert, update, or delete policy'
);

select ok(
  not exists (
    select 1
    from pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'profiles'
      and policy.policyname like 'Staff can %'
  ),
  'staff receives no arbitrary customer profile policy'
);

select ok(
  not exists (
    select 1
    from pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename in (
        'total_loss_case_details',
        'total_loss_analysis_jobs',
        'analysis_runs'
      )
      and policy.policyname like 'Staff can %'
  ),
  'staff receives no Total-Loss or analysis-artifact policy'
);

insert into auth.users (id, email)
values
  ('61111111-1111-4111-8111-111111111111', 'admin-customer-one@example.test'),
  ('62222222-2222-4222-8222-222222222222', 'admin-customer-two@example.test'),
  ('63333333-3333-4333-8333-333333333333', 'admin-staff@example.test'),
  (
    '64444444-4444-4444-8444-444444444444',
    'spoofed-reviewer@venfour.com'
  );

update auth.users
set raw_app_meta_data = '{"staff":true}'::jsonb
where id = '64444444-4444-4444-8444-444444444444';

insert into public.appraisal_cases (
  id,
  user_id,
  service_type,
  status,
  last_activity_at
)
values
  (
    '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '61111111-1111-4111-8111-111111111111',
    'diminished_value',
    'submitted',
    '2026-01-01 12:00:00+00'
  ),
  (
    '6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '61111111-1111-4111-8111-111111111111',
    'diminished_value',
    'draft',
    '2026-01-03 12:00:00+00'
  ),
  (
    '6ccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    '61111111-1111-4111-8111-111111111111',
    'total_loss',
    'submitted',
    '2026-01-04 12:00:00+00'
  ),
  (
    '6ddddddd-dddd-4ddd-8ddd-ddddddddddd4',
    '62222222-2222-4222-8222-222222222222',
    'diminished_value',
    'submitted',
    '2026-01-02 12:00:00+00'
  );

insert into public.diminished_value_case_details (
  case_id,
  draft_step,
  accident_state,
  accident_date,
  repair_status,
  vehicle_entry_method,
  vin,
  vehicle_year,
  vehicle_make,
  vehicle_model,
  vehicle_trim,
  vehicle_configuration,
  mileage_at_accident,
  current_mileage,
  other_party_at_fault,
  at_fault_insurer,
  repair_cost,
  repair_facility,
  structural_damage,
  airbag_deployment,
  major_repair_details,
  full_name,
  email,
  phone,
  preferred_contact_method,
  availability,
  notes,
  submitted_at
)
values
  (
    '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'consultation',
    'IL',
    '2025-12-01',
    'complete',
    'vin',
    '1HGCM82633A004352',
    2022,
    'Honda',
    'Accord',
    'EX-L',
    '{
      "source": "marketcheck",
      "field": "trim",
      "values": ["EX-L"]
    }'::jsonb,
    34000,
    34500,
    'yes',
    'Example Mutual',
    12850.25,
    'Northside Collision',
    'yes',
    'no',
    'Left rail and rear quarter repair.',
    'Customer One',
    'customer-one@example.test',
    '312-555-0101',
    'email',
    'Weekdays after 4 p.m.',
    'Review the final repair invoice.',
    '2026-01-01 12:00:00+00'
  ),
  (
    '6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    'vehicle',
    'IL',
    '2025-12-15',
    'in-progress',
    'details',
    null,
    2021,
    'Toyota',
    'Camry',
    'SE',
    null,
    42000,
    42100,
    'not-sure',
    null,
    null,
    null,
    'not-sure',
    'no',
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null
  ),
  (
    '6ddddddd-dddd-4ddd-8ddd-ddddddddddd4',
    'consultation',
    'TX',
    '2025-12-20',
    'complete',
    'details',
    null,
    2023,
    'Ford',
    'Explorer',
    'Limited',
    null,
    22000,
    22500,
    'yes',
    'Other Carrier',
    9400.00,
    'Central Auto Body',
    'no',
    'yes',
    'Front-end repair and airbag replacement.',
    'Customer Two',
    'customer-two@example.test',
    '214-555-0102',
    'phone',
    'Mornings',
    'Call before reviewing.',
    '2026-01-02 12:00:00+00'
  );

insert into public.total_loss_case_details (case_id, intake_mode)
values ('6ccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'manual');

insert into storage.buckets (id, name, public)
values ('admin-review-other', 'admin-review-other', false);

insert into storage.objects (bucket_id, name, user_metadata)
values
  (
    'case-files',
    '61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/60000000-0000-4000-8000-000000000001.pdf',
    '{"originalName":"repair-invoice.pdf"}'::jsonb
  ),
  (
    'case-files',
    '61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/60000000-0000-4000-8000-000000000002.jpg',
    '{"originalName":"damage-photo.jpg"}'::jsonb
  ),
  (
    'case-files',
    '62222222-2222-4222-8222-222222222222/6ddddddd-dddd-4ddd-8ddd-ddddddddddd4/diminished-value/60000000-0000-4000-8000-000000000003.png',
    '{"originalName":"estimate.png"}'::jsonb
  ),
  (
    'case-files',
    '61111111-1111-4111-8111-111111111111/6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2/diminished-value/60000000-0000-4000-8000-000000000004.pdf',
    '{"originalName":"draft-only.pdf"}'::jsonb
  ),
  (
    'case-files',
    '61111111-1111-4111-8111-111111111111/6ccccccc-cccc-4ccc-8ccc-ccccccccccc3/valuation-report.pdf',
    '{}'::jsonb
  ),
  (
    'case-files',
    '61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/nested/60000000-0000-4000-8000-000000000005.pdf',
    '{"originalName":"nested.pdf"}'::jsonb
  ),
  (
    'case-files',
    '61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/not-a-uuid.pdf',
    '{"originalName":"malformed.pdf"}'::jsonb
  ),
  (
    'case-files',
    '62222222-2222-4222-8222-222222222222/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/60000000-0000-4000-8000-000000000006.pdf',
    '{"originalName":"wrong-owner.pdf"}'::jsonb
  ),
  (
    'admin-review-other',
    '61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/60000000-0000-4000-8000-000000000007.pdf',
    '{"originalName":"wrong-bucket.pdf"}'::jsonb
  );

set local role authenticated;
set local request.jwt.claim.sub = '64444444-4444-4444-8444-444444444444';
set local request.jwt.claims =
  '{"sub":"64444444-4444-4444-8444-444444444444","email":"spoofed-reviewer@venfour.com","role":"authenticated","app_metadata":{"staff":true}}';

select is(
  public.is_venfour_staff(),
  false,
  'a Venfour-looking email and staff-shaped auth metadata do not grant staff access'
);

select results_eq(
  $$select count(*) from public.list_submitted_diminished_value_cases()$$,
  $$values (0::bigint)$$,
  'spoofed email and auth metadata cannot open the submitted-DV queue'
);

select results_eq(
  $$select count(*) from public.get_submitted_diminished_value_case('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$$,
  $$values (0::bigint)$$,
  'spoofed email and auth metadata cannot open a submitted-DV detail'
);

select is(
  public.authorize_staff_diminished_value_document_read(
    '61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/60000000-0000-4000-8000-000000000001.pdf'
  ),
  false,
  'spoofed email and auth metadata cannot authorize a submitted document path'
);

select results_eq(
  $$select count(*) from storage.objects where bucket_id = 'case-files'$$,
  $$values (0::bigint)$$,
  'spoofed email and auth metadata cannot read submitted Storage objects'
);

set local request.jwt.claim.sub = '62222222-2222-4222-8222-222222222222';
set local request.jwt.claims =
  '{"sub":"62222222-2222-4222-8222-222222222222","email":"admin-customer-two@example.test","role":"authenticated","app_metadata":{}}';

select is(
  public.is_venfour_staff(),
  false,
  'an ordinary authenticated customer is not staff'
);

select results_eq(
  $$select count(*) from public.list_submitted_diminished_value_cases()$$,
  $$values (0::bigint)$$,
  'a nonstaff customer cannot list the submitted-DV staff queue'
);

select results_eq(
  $$select count(*) from public.get_submitted_diminished_value_case('6ddddddd-dddd-4ddd-8ddd-ddddddddddd4')$$,
  $$values (0::bigint)$$,
  'a nonstaff owner cannot use the staff detail RPC for their own submission'
);

select results_eq(
  $$select count(*) from public.get_submitted_diminished_value_case('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$$,
  $$values (0::bigint)$$,
  'a nonstaff customer cannot use the staff detail RPC for another submission'
);

select results_eq(
  $$select count(*) from public.appraisal_cases where id = '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,
  $$values (0::bigint)$$,
  'existing case RLS hides another customer submitted DV parent from nonstaff'
);

select results_eq(
  $$select count(*) from public.diminished_value_case_details where case_id = '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'$$,
  $$values (0::bigint)$$,
  'existing details RLS hides another customer submitted DV intake from nonstaff'
);

select results_eq(
  $$
    select count(*)
    from storage.objects
    where bucket_id = 'case-files'
      and name like '%/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/%'
  $$,
  $$values (0::bigint)$$,
  'existing Storage RLS hides another customer submitted documents from nonstaff'
);

select throws_ok(
  $$
    insert into public.staff_members (user_id)
    values ('62222222-2222-4222-8222-222222222222')
  $$,
  '42501',
  null,
  'a customer cannot self-create staff authorization'
);

select throws_ok(
  $$
    delete from public.staff_members
    where user_id = '63333333-3333-4333-8333-333333333333'
  $$,
  '42501',
  null,
  'a customer cannot revoke or inspect another staff authorization'
);

reset role;
set local role service_role;

select lives_ok(
  $$
    insert into public.staff_members (user_id)
    values ('63333333-3333-4333-8333-333333333333')
  $$,
  'the service role can grant staff access by auth user ID'
);

select results_eq(
  $$
    select count(*)
    from public.staff_members
    where user_id = '63333333-3333-4333-8333-333333333333'
  $$,
  $$values (1::bigint)$$,
  'the service role can verify the durable staff grant'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '63333333-3333-4333-8333-333333333333';
set local request.jwt.claims =
  '{"sub":"63333333-3333-4333-8333-333333333333","email":"admin-staff@example.test","role":"authenticated","app_metadata":{}}';

select is(
  public.is_venfour_staff(),
  true,
  'the granted identity is authorized immediately'
);

select results_eq(
  $$
    select case_id, submitted_at, document_count
    from public.list_submitted_diminished_value_cases()
  $$,
  $$
    values
      (
        '6ddddddd-dddd-4ddd-8ddd-ddddddddddd4'::uuid,
        '2026-01-02 12:00:00+00'::timestamptz,
        1::bigint
      ),
      (
        '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
        '2026-01-01 12:00:00+00'::timestamptz,
        2::bigint
      )
  $$,
  'the staff queue is newest-first and counts only canonical submitted DV documents'
);

select results_eq(
  $$
    select
      owner_user_id,
      service_type::text,
      status::text,
      full_name,
      email,
      phone,
      preferred_contact_method,
      vehicle_year,
      vehicle_make,
      vehicle_model,
      accident_date,
      at_fault_insurer
    from public.list_submitted_diminished_value_cases()
    where case_id = '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  $$
    values (
      '61111111-1111-4111-8111-111111111111'::uuid,
      'diminished_value'::text,
      'submitted'::text,
      'Customer One'::text,
      'customer-one@example.test'::text,
      '312-555-0101'::text,
      'email'::text,
      2022::smallint,
      'Honda'::text,
      'Accord'::text,
      '2025-12-01'::date,
      'Example Mutual'::text
    )
  $$,
  'the queue exposes only the practical submitted review summary fields'
);

select results_eq(
  $$select count(*) from public.list_submitted_diminished_value_cases()$$,
  $$values (2::bigint)$$,
  'the queue excludes draft DV and submitted Total-Loss cases'
);

select is(
  (
    select to_jsonb(review_case)
    from public.get_submitted_diminished_value_case(
      '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    ) as review_case
  ),
  (
    select
      to_jsonb(details)
      || jsonb_build_object(
        'owner_user_id', appraisal_case.user_id,
        'service_type', appraisal_case.service_type,
        'status', appraisal_case.status
      )
    from public.diminished_value_case_details as details
    join public.appraisal_cases as appraisal_case
      on appraisal_case.id = details.case_id
    where details.case_id = '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'the staff detail RPC returns every persisted DV detail plus its parent review identity'
);

select results_eq(
  $$select count(*) from public.get_submitted_diminished_value_case('60000000-0000-4000-8000-000000000099')$$,
  $$values (0::bigint)$$,
  'a nonexistent case returns no row without leaking identifiers'
);

select results_eq(
  $$select count(*) from public.get_submitted_diminished_value_case('6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2')$$,
  $$values (0::bigint)$$,
  'a draft DV case is unavailable through the staff detail RPC'
);

select results_eq(
  $$select count(*) from public.get_submitted_diminished_value_case('6ccccccc-cccc-4ccc-8ccc-ccccccccccc3')$$,
  $$values (0::bigint)$$,
  'a submitted Total-Loss case is unavailable through the staff detail RPC'
);

select results_eq(
  $$select id from public.appraisal_cases order by id$$,
  $$
    values
      ('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid),
      ('6ddddddd-dddd-4ddd-8ddd-ddddddddddd4'::uuid)
  $$,
  'staff table RLS exposes only submitted DV parent cases'
);

select results_eq(
  $$select case_id from public.diminished_value_case_details order by case_id$$,
  $$
    values
      ('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid),
      ('6ddddddd-dddd-4ddd-8ddd-ddddddddddd4'::uuid)
  $$,
  'staff table RLS exposes only submitted DV details'
);

select results_eq(
  $$
    select count(*)
    from public.profiles
    where id in (
      '61111111-1111-4111-8111-111111111111',
      '62222222-2222-4222-8222-222222222222'
    )
  $$,
  $$values (0::bigint)$$,
  'staff cannot read arbitrary customer profiles'
);

select results_eq(
  $$
    select count(*)
    from public.profiles
    where id = '63333333-3333-4333-8333-333333333333'
  $$,
  $$values (1::bigint)$$,
  'staff retains ordinary owner access to their own profile'
);

select results_eq(
  $$
    select count(*)
    from public.total_loss_case_details
    where case_id = '6ccccccc-cccc-4ccc-8ccc-ccccccccccc3'
  $$,
  $$values (0::bigint)$$,
  'staff gains no read access to another customer Total-Loss details'
);

select results_eq(
  $$
    select name
    from storage.objects
    where bucket_id = 'case-files'
    order by name
  $$,
  $$
    values
      ('61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/60000000-0000-4000-8000-000000000001.pdf'::text),
      ('61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/60000000-0000-4000-8000-000000000002.jpg'::text),
      ('62222222-2222-4222-8222-222222222222/6ddddddd-dddd-4ddd-8ddd-ddddddddddd4/diminished-value/60000000-0000-4000-8000-000000000003.png'::text)
  $$,
  'staff Storage RLS exposes only exact canonical submitted DV objects'
);

select is(
  public.authorize_staff_diminished_value_document_read(
    '61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/60000000-0000-4000-8000-000000000001.pdf'
  ),
  true,
  'the exact canonical submitted DV path is authorized for staff'
);

select is(
  public.authorize_staff_diminished_value_document_read(
    '61111111-1111-4111-8111-111111111111/6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2/diminished-value/60000000-0000-4000-8000-000000000004.pdf'
  ),
  false,
  'a draft DV document path is denied to staff'
);

select is(
  public.authorize_staff_diminished_value_document_read(
    '61111111-1111-4111-8111-111111111111/6ccccccc-cccc-4ccc-8ccc-ccccccccccc3/diminished-value/60000000-0000-4000-8000-000000000005.pdf'
  ),
  false,
  'a Total-Loss case cannot be disguised as a staff DV document path'
);

select is(
  public.authorize_staff_diminished_value_document_read(
    '62222222-2222-4222-8222-222222222222/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/60000000-0000-4000-8000-000000000006.pdf'
  ),
  false,
  'a mismatched owner and case namespace is denied to staff'
);

select is(
  public.authorize_staff_diminished_value_document_read(
    '61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/nested/60000000-0000-4000-8000-000000000005.pdf'
  ),
  false,
  'an extra nested path segment is denied to staff'
);

select is(
  public.authorize_staff_diminished_value_document_read(
    '61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/not-a-uuid.pdf'
  ),
  false,
  'a noncanonical document filename is denied to staff'
);

select is(
  public.authorize_staff_diminished_value_document_read(
    '61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/../60000000-0000-4000-8000-000000000009.pdf'
  ),
  false,
  'a literal traversal segment is denied to staff'
);

select is(
  public.authorize_staff_diminished_value_document_read(
    '61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/%2e%2e/60000000-0000-4000-8000-000000000009.pdf'
  ),
  false,
  'an encoded traversal segment is denied to staff'
);

select is(
  public.authorize_staff_diminished_value_document_read(
    '61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/60000000-0000-4000-8000-000000000009.exe'
  ),
  false,
  'a canonical UUID with an unsupported extension is denied to staff'
);

select results_eq(
  $$select count(*) from storage.objects where bucket_id = 'admin-review-other'$$,
  $$values (0::bigint)$$,
  'staff cannot read an identical-looking path from another private bucket'
);

select results_eq(
  $$
    select user_metadata ->> 'originalName'
    from storage.objects
    where bucket_id = 'case-files'
    order by user_metadata ->> 'originalName'
  $$,
  $$
    values
      ('damage-photo.jpg'::text),
      ('estimate.png'::text),
      ('repair-invoice.pdf'::text)
  $$,
  'staff can read safe submitted document display metadata'
);

select results_eq(
  $$
    with changed as (
      update public.appraisal_cases
      set last_activity_at = statement_timestamp()
      where id = '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      returning 1
    )
    select count(*) from changed
  $$,
  $$values (0::bigint)$$,
  'staff cannot update activity on a reviewed customer case'
);

select throws_ok(
  $$
    update public.appraisal_cases
    set status = 'closed'
    where id = '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '42501',
  null,
  'staff cannot change a reviewed case status'
);

select throws_ok(
  $$
    delete from public.appraisal_cases
    where id = '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '42501',
  null,
  'staff cannot delete a reviewed customer case'
);

select results_eq(
  $$
    with changed as (
      update public.diminished_value_case_details
      set notes = 'Staff must not change this.'
      where case_id = '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      returning 1
    )
    select count(*) from changed
  $$,
  $$values (0::bigint)$$,
  'staff cannot update submitted DV details'
);

select throws_ok(
  $$
    insert into public.diminished_value_case_details (case_id)
    values ('6ccccccc-cccc-4ccc-8ccc-ccccccccccc3')
  $$,
  '42501',
  null,
  'staff cannot create details below another customer case'
);

select throws_ok(
  $$
    delete from public.diminished_value_case_details
    where case_id = '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '42501',
  null,
  'staff cannot delete submitted DV details'
);

select throws_ok(
  $$select * from public.submit_diminished_value_case('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$$,
  '42501',
  null,
  'staff cannot invoke the customer submission RPC for a reviewed case'
);

select is(
  (
    select (public.touch_appraisal_case(
      '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    )).id
  ),
  null::uuid,
  'staff cannot mutate a reviewed case through the customer activity RPC'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    values (
      'case-files',
      '61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/60000000-0000-4000-8000-000000000008.pdf',
      '{"originalName":"staff-upload.pdf"}'::jsonb
    )
  $$,
  '42501',
  null,
  'staff cannot add a document to a submitted customer case'
);

select results_eq(
  $$
    with changed as (
      update storage.objects
      set user_metadata = '{"originalName":"staff-changed.pdf"}'::jsonb
      where bucket_id = 'case-files'
        and name like '%/60000000-0000-4000-8000-000000000001.pdf'
      returning 1
    )
    select count(*) from changed
  $$,
  $$values (0::bigint)$$,
  'staff cannot change submitted document metadata'
);

select results_eq(
  $$
    with changed as (
      update storage.objects
      set name = '61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/60000000-0000-4000-8000-000000000099.pdf'
      where bucket_id = 'case-files'
        and name like '%/60000000-0000-4000-8000-000000000001.pdf'
      returning 1
    )
    select count(*) from changed
  $$,
  $$values (0::bigint)$$,
  'staff cannot rename or move a submitted document'
);

select results_eq(
  $$
    with removed as (
      delete from storage.objects
      where bucket_id = 'case-files'
        and name like '%/60000000-0000-4000-8000-000000000001.pdf'
      returning 1
    )
    select count(*) from removed
  $$,
  $$values (0::bigint)$$,
  'staff cannot delete a submitted document'
);

select throws_ok(
  $$
    delete from public.staff_members
    where user_id = '63333333-3333-4333-8333-333333333333'
  $$,
  '42501',
  null,
  'staff cannot revoke its own database authorization'
);

reset role;
set local role service_role;

select lives_ok(
  $$
    delete from public.staff_members
    where user_id = '63333333-3333-4333-8333-333333333333'
  $$,
  'the service role can revoke staff access by auth user ID'
);

select results_eq(
  $$
    select count(*)
    from public.staff_members
    where user_id = '63333333-3333-4333-8333-333333333333'
  $$,
  $$values (0::bigint)$$,
  'the staff revocation is durable immediately'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '63333333-3333-4333-8333-333333333333';
set local request.jwt.claims =
  '{"sub":"63333333-3333-4333-8333-333333333333","email":"admin-staff@example.test","role":"authenticated","app_metadata":{}}';

select is(
  public.is_venfour_staff(),
  false,
  'the revoked identity immediately fails the staff check'
);

select results_eq(
  $$select count(*) from public.list_submitted_diminished_value_cases()$$,
  $$values (0::bigint)$$,
  'revoked staff immediately loses queue access'
);

select results_eq(
  $$select count(*) from public.get_submitted_diminished_value_case('6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$$,
  $$values (0::bigint)$$,
  'revoked staff immediately loses detail RPC access'
);

select results_eq(
  $$select count(*) from public.appraisal_cases$$,
  $$values (0::bigint)$$,
  'revoked staff immediately loses submitted parent visibility'
);

select results_eq(
  $$select count(*) from public.diminished_value_case_details$$,
  $$values (0::bigint)$$,
  'revoked staff immediately loses submitted detail visibility'
);

select results_eq(
  $$select count(*) from storage.objects where bucket_id = 'case-files'$$,
  $$values (0::bigint)$$,
  'revoked staff immediately loses submitted document visibility'
);

select is(
  public.authorize_staff_diminished_value_document_read(
    '61111111-1111-4111-8111-111111111111/6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/diminished-value/60000000-0000-4000-8000-000000000001.pdf'
  ),
  false,
  'revoked staff immediately fails document authorization'
);

reset role;

select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'case-files'
      and name like '%/60000000-0000-4000-8000-000000000001.pdf'
  ),
  1::bigint,
  'staff mutation attempts leave the submitted document intact'
);

set local role authenticated;
set local request.jwt.claim.sub = '61111111-1111-4111-8111-111111111111';
set local request.jwt.claims =
  '{"sub":"61111111-1111-4111-8111-111111111111","email":"admin-customer-one@example.test","role":"authenticated","app_metadata":{}}';

select results_eq(
  $$
    select count(*)
    from public.appraisal_cases
    where id = '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  $$values (1::bigint)$$,
  'the ordinary owner can still read their submitted DV parent'
);

select results_eq(
  $$
    select count(*)
    from public.diminished_value_case_details
    where case_id = '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  $$values (1::bigint)$$,
  'the ordinary owner can still read their submitted DV details'
);

select results_eq(
  $$
    select count(*)
    from storage.objects
    where bucket_id = 'case-files'
      and storage.foldername(name) = array[
        '61111111-1111-4111-8111-111111111111',
        '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        'diminished-value'
      ]::text[]
      and storage.filename(name) ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|heic|heif)$'
  $$,
  $$values (2::bigint)$$,
  'the ordinary owner can still read canonical submitted documents'
);

select results_eq(
  $$
    with changed as (
      update public.diminished_value_case_details
      set notes = 'Submitted owner change must fail.'
      where case_id = '6aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      returning 1
    )
    select count(*) from changed
  $$,
  $$values (0::bigint)$$,
  'existing submitted-detail immutability remains intact for the owner'
);

select lives_ok(
  $$
    update public.diminished_value_case_details
    set notes = 'Owner draft remains editable.'
    where case_id = '6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  $$,
  'the ordinary owner can still edit their DV draft'
);

select is(
  (
    select notes
    from public.diminished_value_case_details
    where case_id = '6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  ),
  'Owner draft remains editable.',
  'the owner draft edit is persisted'
);

select results_eq(
  $$
    select count(*)
    from storage.objects
    where bucket_id = 'case-files'
      and name like '%/6bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2/%'
  $$,
  $$values (1::bigint)$$,
  'the ordinary owner can still read their private draft document'
);

select results_eq(
  $$
    select count(*)
    from public.appraisal_cases
    where id = '6ddddddd-dddd-4ddd-8ddd-ddddddddddd4'
  $$,
  $$values (0::bigint)$$,
  'existing cross-user parent isolation remains intact'
);

select results_eq(
  $$
    select count(*)
    from public.diminished_value_case_details
    where case_id = '6ddddddd-dddd-4ddd-8ddd-ddddddddddd4'
  $$,
  $$values (0::bigint)$$,
  'existing cross-user detail isolation remains intact'
);

select results_eq(
  $$
    select count(*)
    from storage.objects
    where bucket_id = 'case-files'
      and name like '%/6ddddddd-dddd-4ddd-8ddd-ddddddddddd4/%'
  $$,
  $$values (0::bigint)$$,
  'existing cross-user document isolation remains intact'
);

select throws_ok(
  $$
    insert into public.staff_members (user_id)
    values ('61111111-1111-4111-8111-111111111111')
  $$,
  '42501',
  null,
  'an ordinary owner cannot self-grant staff access'
);

select * from finish();
rollback;
