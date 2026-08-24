begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
set local storage.allow_delete_query = 'true';

select plan(73);

select has_table(
  'public',
  'diminished_value_case_details',
  'diminished-value details table exists'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_class as relation
    where relation.oid = 'public.diminished_value_case_details'::regclass
  ),
  'diminished-value details have row-level security enabled'
);

select col_is_pk(
  'public',
  'diminished_value_case_details',
  'case_id',
  'case_id is the one-to-one primary key'
);

select fk_ok(
  'public',
  'diminished_value_case_details',
  'case_id',
  'public',
  'appraisal_cases',
  'id',
  'case_id references the provider-neutral parent case'
);

select ok(
  (
    select foreign_key.confdeltype = 'c'
    from pg_constraint as foreign_key
    where foreign_key.conrelid = 'public.diminished_value_case_details'::regclass
      and foreign_key.contype = 'f'
      and foreign_key.conname = 'diminished_value_case_details_case_id_fkey'
  ),
  'details cascade when their parent case is removed'
);

select is(
  (
    select column_info.column_default
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'diminished_value_case_details'
      and column_info.column_name = 'draft_step'
  ),
  '''start''::text',
  'drafts begin at the first editable step'
);

select is(
  (
    select column_info.column_default
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'diminished_value_case_details'
      and column_info.column_name = 'revision'
  ),
  '0',
  'new details begin at server revision zero'
);

select ok(
  (
    select column_info.is_nullable = 'YES'
      and column_info.column_default is null
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'diminished_value_case_details'
      and column_info.column_name = 'submitted_at'
  ),
  'submitted_at begins nullable without a browser-controlled default'
);

select ok(
  exists (
    select 1
    from pg_trigger as trigger
    where trigger.tgrelid = 'public.diminished_value_case_details'::regclass
      and trigger.tgname = 'diminished_value_case_details_set_version'
      and not trigger.tgisinternal
  ),
  'details have a server revision trigger'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.proretset
      and procedure.prorettype = 'public.diminished_value_submission_result'::regtype
    from pg_proc as procedure
    where procedure.oid = 'public.submit_diminished_value_case(uuid)'::regprocedure
  ),
  'submission is a SECURITY DEFINER RPC returning only its receipt type'
);

select ok(
  (
    select 'search_path=""' = any(procedure.proconfig)
    from pg_proc as procedure
    where procedure.oid = 'public.submit_diminished_value_case(uuid)'::regprocedure
  ),
  'submission pins an empty search path'
);

select ok(
  not exists (
    select 1
    from pg_proc as procedure
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as function_acl
    where procedure.oid in (
      'public.submit_diminished_value_case(uuid)'::regprocedure,
      'public.authorize_diminished_value_document_mutation(text)'::regprocedure,
      'public.set_diminished_value_case_details_version()'::regprocedure
    )
      and function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute any diminished-value function'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.submit_diminished_value_case(uuid)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'anon',
      'public.authorize_diminished_value_document_mutation(text)',
      'EXECUTE'
    ),
  'anonymous clients cannot execute diminished-value functions'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.submit_diminished_value_case(uuid)',
    'EXECUTE'
  )
    and has_function_privilege(
      'authenticated',
      'public.authorize_diminished_value_document_mutation(text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.set_diminished_value_case_details_version()',
      'EXECUTE'
    ),
  'authenticated clients receive only the submission and storage authorization surface'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.submit_diminished_value_case(uuid)',
    'EXECUTE'
  ),
  'service credentials cannot impersonate a customer submission'
);

select ok(
  has_column_privilege(
    'authenticated',
    'public.diminished_value_case_details',
    'revision',
    'SELECT'
  )
    and not has_column_privilege(
      'authenticated',
      'public.diminished_value_case_details',
      'revision',
      'INSERT'
    )
    and not has_column_privilege(
      'authenticated',
      'public.diminished_value_case_details',
      'revision',
      'UPDATE'
    ),
  'revision is browser-readable and server-controlled'
);

select ok(
  has_column_privilege(
    'authenticated',
    'public.diminished_value_case_details',
    'submitted_at',
    'SELECT'
  )
    and not has_column_privilege(
      'authenticated',
      'public.diminished_value_case_details',
      'submitted_at',
      'INSERT'
    )
    and not has_column_privilege(
      'authenticated',
      'public.diminished_value_case_details',
      'submitted_at',
      'UPDATE'
    ),
  'submitted_at is browser-readable and server-controlled'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.diminished_value_case_details',
    'SELECT'
  )
    and not has_table_privilege(
      'authenticated',
      'public.diminished_value_case_details',
      'DELETE'
    ),
  'anonymous reads and browser detail deletion are unavailable'
);

select is(
  (select bucket.file_size_limit from storage.buckets as bucket where bucket.id = 'case-files'),
  52428800::bigint,
  'the shared bucket retains its portable 50 MiB server limit'
);

select ok(
  (
    select procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
    from pg_proc as procedure
    where procedure.oid =
      'public.authorize_diminished_value_document_mutation(text)'::regprocedure
  ),
  'DV document authorization is a search-path-pinned SECURITY DEFINER helper'
);

insert into auth.users (id, email)
values
  ('51111111-1111-4111-8111-111111111111', 'dv-user-one@example.test'),
  ('52222222-2222-4222-8222-222222222222', 'dv-user-two@example.test');

insert into public.appraisal_cases (id, user_id, service_type)
values
  (
    '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '51111111-1111-4111-8111-111111111111',
    'diminished_value'
  ),
  (
    '5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '52222222-2222-4222-8222-222222222222',
    'diminished_value'
  ),
  (
    '5ccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    '51111111-1111-4111-8111-111111111111',
    'total_loss'
  ),
  (
    '5ddddddd-dddd-4ddd-8ddd-ddddddddddd4',
    '51111111-1111-4111-8111-111111111111',
    'diminished_value'
  ),
  (
    '5eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
    '51111111-1111-4111-8111-111111111111',
    'diminished_value'
  ),
  (
    '5fffffff-ffff-4fff-8fff-fffffffffff6',
    '51111111-1111-4111-8111-111111111111',
    'diminished_value'
  );

insert into public.total_loss_case_details (case_id, intake_mode)
values ('5ccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'manual');

insert into public.diminished_value_case_details (
  case_id,
  draft_step,
  accident_state,
  accident_date,
  repair_status,
  vehicle_entry_method,
  vin,
  mileage_at_accident,
  other_party_at_fault,
  structural_damage,
  airbag_deployment,
  full_name,
  email,
  phone,
  preferred_contact_method,
  availability
)
values (
  '5ddddddd-dddd-4ddd-8ddd-ddddddddddd4',
  'consultation',
  'IL',
  current_date + 1,
  'complete',
  'vin',
  '1HGCM82633A004352',
  45000,
  'yes',
  'no',
  'no',
  'Future Date',
  'future@example.test',
  '312-555-0100',
  'email',
  'Weekdays after 4 p.m. Central Time'
), (
  '5eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',
  'consultation',
  'IL',
  current_date - 1,
  'complete',
  'details',
  null,
  45000,
  'yes',
  'no',
  'no',
  'Missing Vehicle',
  'vehicle@example.test',
  '312-555-0101',
  'phone',
  'Weekdays after 4 p.m. Central Time'
), (
  '5fffffff-ffff-4fff-8fff-fffffffffff6',
  'consultation',
  'IL',
  current_date - 1,
  'complete',
  'vin',
  '1HGCM82633A004352',
  45000,
  'yes',
  'no',
  'no',
  'Storage Owner',
  'storage@example.test',
  '312-555-0102',
  'email',
  'Weekdays after 4 p.m. Central Time'
);

create temporary table diminished_value_submission_receipts (
  label text primary key,
  case_id uuid not null,
  status public.appraisal_case_status not null,
  submitted_at timestamptz not null,
  revision bigint not null
);

grant select, insert on table pg_temp.diminished_value_submission_receipts
to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '51111111-1111-4111-8111-111111111111';

select lives_ok(
  $$
    insert into public.diminished_value_case_details (case_id)
    values ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')
  $$,
  'a customer can create details for their owned DV draft'
);

select results_eq(
  $$
    select draft_step, vehicle_entry_method, revision, submitted_at is null
    from public.diminished_value_case_details
    where case_id = '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  $$values ('start'::text, 'vin'::text, 0::bigint, true)$$,
  'new details use safe draft and version defaults'
);

select throws_ok(
  $$
    insert into public.diminished_value_case_details (case_id)
    values ('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2')
  $$,
  '42501',
  null,
  'a customer cannot create details for another user'
);

select throws_ok(
  $$
    insert into public.diminished_value_case_details (case_id)
    values ('5ccccccc-cccc-4ccc-8ccc-ccccccccccc3')
  $$,
  '42501',
  null,
  'DV details cannot be attached to a total-loss parent'
);

select results_eq(
  $$
    select case_id
    from public.diminished_value_case_details
    order by case_id
  $$,
  $$values ('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid),
  ('5ddddddd-dddd-4ddd-8ddd-ddddddddddd4'::uuid),
  ('5eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5'::uuid),
  ('5fffffff-ffff-4fff-8fff-fffffffffff6'::uuid)$$,
  'a customer reads only their own DV details'
);

select lives_ok(
  $$
    update public.diminished_value_case_details
    set
      draft_step = 'vehicle',
      accident_state = 'IL'
    where case_id = '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      and revision = 0
  $$,
  'an exact draft revision can be progressively saved'
);

select results_eq(
  $$
    select draft_step, accident_state, revision
    from public.diminished_value_case_details
    where case_id = '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  $$values ('vehicle'::text, 'IL'::text, 1::bigint)$$,
  'a material save advances the server revision once'
);

select lives_ok(
  $$
    update public.diminished_value_case_details
    set accident_state = 'IL'
    where case_id = '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      and revision = 1
  $$,
  'a no-op retry is accepted at the same revision'
);

select is(
  (
    select revision
    from public.diminished_value_case_details
    where case_id = '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  1::bigint,
  'a no-op retry does not create a false revision'
);

select throws_ok(
  $$
    update public.diminished_value_case_details
    set draft_step = 'complete'
    where case_id = '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '23514',
  null,
  'complete is never an editable draft step'
);

select throws_ok(
  $$
    update public.diminished_value_case_details
    set revision = 99
    where case_id = '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '42501',
  null,
  'a browser cannot forge the optimistic revision'
);

select throws_ok(
  $$
    update public.diminished_value_case_details
    set submitted_at = statement_timestamp()
    where case_id = '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '42501',
  null,
  'a browser cannot forge the submission time'
);

select throws_ok(
  $$
    update public.appraisal_cases
    set status = 'submitted'
    where id = '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '42501',
  null,
  'a browser cannot forge the submitted parent status'
);

select throws_ok(
  $$select * from public.submit_diminished_value_case('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$$,
  '22023',
  null,
  'submission rejects an incomplete draft'
);

select results_eq(
  $$
    select status::text, submitted_at is null
    from public.appraisal_cases
    join public.diminished_value_case_details as details
      on details.case_id = appraisal_cases.id
    where appraisal_cases.id = '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  $$values ('draft'::text, true)$$,
  'a rejected submission leaves both durable state markers untouched'
);

select throws_ok(
  $$select * from public.submit_diminished_value_case('5ddddddd-dddd-4ddd-8ddd-ddddddddddd4')$$,
  '22023',
  null,
  'submission rejects a future accident date'
);

select throws_ok(
  $$select * from public.submit_diminished_value_case('5eeeeeee-eeee-4eee-8eee-eeeeeeeeeee5')$$,
  '22023',
  null,
  'submission rejects an incomplete manual vehicle identity'
);

select throws_ok(
  $$select * from public.submit_diminished_value_case('5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2')$$,
  '42501',
  null,
  'a customer cannot submit another user case'
);

select throws_ok(
  $$select * from public.submit_diminished_value_case('5ccccccc-cccc-4ccc-8ccc-ccccccccccc3')$$,
  '42501',
  null,
  'the DV submission RPC rejects a total-loss parent'
);

select throws_ok(
  $$select * from public.submit_diminished_value_case('50000000-0000-4000-8000-000000000099')$$,
  '42501',
  null,
  'a missing case uses the same unavailable ownership boundary'
);

select lives_ok(
  $$
    update public.diminished_value_case_details
    set
      draft_step = 'consultation',
      accident_date = current_date - 1,
      repair_status = 'complete',
      vin = '1HGCM82633A004352',
      mileage_at_accident = 45000,
      current_mileage = 45500,
      other_party_at_fault = 'yes',
      at_fault_insurer = 'Example Mutual',
      repair_cost = 12500.00,
      repair_facility = 'Example Collision',
      structural_damage = 'no',
      airbag_deployment = 'no',
      major_repair_details = 'Front body repairs.',
      full_name = 'Case Owner',
      email = 'owner@example.test',
      phone = '312-555-0110',
      preferred_contact_method = 'email',
      availability = 'Weekdays after 4 p.m. Central Time',
      notes = 'Please review the repair record.'
    where case_id = '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
      and revision = 1
  $$,
  'the remaining required fields can be saved at the expected revision'
);

select lives_ok(
  $$
    insert into pg_temp.diminished_value_submission_receipts
    select
      'initial',
      submission.case_id,
      submission.status,
      submission.submitted_at,
      submission.revision
    from public.submit_diminished_value_case(
      '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    ) as submission
  $$,
  'a complete owned DV draft submits authoritatively'
);

select results_eq(
  $$
    select status::text, submitted_at is not null, revision
    from pg_temp.diminished_value_submission_receipts
    where label = 'initial'
  $$,
  $$values ('submitted'::text, true, 3::bigint)$$,
  'the RPC returns submitted state and the server-incremented receipt revision'
);

select ok(
  (
    select appraisal_case.status = 'submitted'
      and appraisal_case.last_activity_at = details.submitted_at
      and details.submitted_at = receipt.submitted_at
      and details.revision = receipt.revision
    from public.appraisal_cases as appraisal_case
    join public.diminished_value_case_details as details
      on details.case_id = appraisal_case.id
    join pg_temp.diminished_value_submission_receipts as receipt
      on receipt.case_id = appraisal_case.id
      and receipt.label = 'initial'
    where appraisal_case.id = '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'submission atomically persists one database timestamp, status, activity, and revision'
);

select lives_ok(
  $$
    insert into pg_temp.diminished_value_submission_receipts
    select
      'retry',
      submission.case_id,
      submission.status,
      submission.submitted_at,
      submission.revision
    from public.submit_diminished_value_case(
      '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    ) as submission
  $$,
  'a committed submission can be retried safely'
);

select results_eq(
  $$
    select
      first.submitted_at = retry.submitted_at,
      first.revision = retry.revision,
      retry.status::text
    from pg_temp.diminished_value_submission_receipts as first
    join pg_temp.diminished_value_submission_receipts as retry on true
    where first.label = 'initial'
      and retry.label = 'retry'
  $$,
  $$values (true, true, 'submitted'::text)$$,
  'duplicate submission returns the original timestamp and revision'
);

select results_eq(
  $$
    with changed as (
      update public.diminished_value_case_details
      set notes = 'This must not be saved.'
      where case_id = '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
        and revision = 3
      returning 1
    )
    select count(*) from changed
  $$,
  $$values (0::bigint)$$,
  'submitted details are immutable to the browser'
);

select is(
  (
    select notes
    from public.diminished_value_case_details
    where case_id = '5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'Please review the repair record.',
  'the rejected post-submission edit leaves material data unchanged'
);

set local request.jwt.claim.sub = '52222222-2222-4222-8222-222222222222';

select throws_ok(
  $$select * from public.submit_diminished_value_case('5aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$$,
  '42501',
  null,
  'another authenticated user cannot observe an existing submission receipt'
);

set local request.jwt.claim.sub = '51111111-1111-4111-8111-111111111111';

select is(
  public.authorize_diminished_value_document_mutation(
    '51111111-1111-4111-8111-111111111111/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/50000000-0000-4000-8000-000000000001.pdf'
  ),
  true,
  'the exact owned draft DV namespace is authorized'
);

select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    values (
      'case-files',
      '51111111-1111-4111-8111-111111111111/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/50000000-0000-4000-8000-000000000001.pdf',
      '{"originalName":"repair-estimate.pdf"}'::jsonb
    )
  $$,
  'an owned draft accepts an exact PDF document path and safe display name'
);

select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    values (
      'case-files',
      '51111111-1111-4111-8111-111111111111/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/50000000-0000-4000-8000-000000000002.jpg',
      '{"originalName":"damage-photo.jpeg"}'::jsonb
    )
  $$,
  'an owned draft accepts an exact canonical image document path'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    values (
      'case-files',
      '51111111-1111-4111-8111-111111111111/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/50000000-0000-4000-8000-000000000003.pdf',
      '{"originalName":"damage-photo.jpg"}'::jsonb
    )
  $$,
  '42501',
  null,
  'the canonical object extension must match the display filename format'
);

select results_eq(
  $$
    select count(*)
    from storage.objects
    where bucket_id = 'case-files'
      and name like '%/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/%'
  $$,
  $$values (2::bigint)$$,
  'the owner can list persisted documents for resuming the draft'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    values (
      'case-files',
      '51111111-1111-4111-8111-111111111111/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/50000000-0000-4000-8000-000000000003.exe',
      '{"originalName":"unsafe.exe"}'::jsonb
    )
  $$,
  '42501',
  null,
  'an unsupported canonical extension is denied'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    values (
      'case-files',
      '51111111-1111-4111-8111-111111111111/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/not-a-uuid.pdf',
      '{"originalName":"estimate.pdf"}'::jsonb
    )
  $$,
  '42501',
  null,
  'a non-UUID document object name is denied'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    values (
      'case-files',
      '51111111-1111-4111-8111-111111111111/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/nested/50000000-0000-4000-8000-000000000003.pdf',
      '{"originalName":"estimate.pdf"}'::jsonb
    )
  $$,
  '42501',
  null,
  'an extra path segment cannot escape the exact DV namespace'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    values (
      'case-files',
      '51111111-1111-4111-8111-111111111111/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/50000000-0000-4000-8000-000000000003.pdf',
      '{"originalName":"../estimate.pdf"}'::jsonb
    )
  $$,
  '42501',
  null,
  'an unsafe original display filename is denied'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    values (
      'case-files',
      '51111111-1111-4111-8111-111111111111/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/50000000-0000-4000-8000-000000000003.pdf',
      '{"originalName":"  estimate.pdf"}'::jsonb
    )
  $$,
  '42501',
  null,
  'an unnormalized original display filename is denied'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    values (
      'case-files',
      '51111111-1111-4111-8111-111111111111/5bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2/diminished-value/50000000-0000-4000-8000-000000000003.pdf',
      '{"originalName":"estimate.pdf"}'::jsonb
    )
  $$,
  '42501',
  null,
  'a document cannot target another user case under the caller namespace'
);

select results_eq(
  $$
    with changed as (
      update storage.objects
      set name = '51111111-1111-4111-8111-111111111111/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/50000000-0000-4000-8000-000000000099.pdf'
      where bucket_id = 'case-files'
        and name like '%/diminished-value/50000000-0000-4000-8000-000000000001.pdf'
      returning 1
    )
    select count(*) from changed
  $$,
  $$values (0::bigint)$$,
  'DV objects cannot be updated, renamed, or moved'
);

set local request.jwt.claim.sub = '52222222-2222-4222-8222-222222222222';

select results_eq(
  $$
    select count(*)
    from storage.objects
    where bucket_id = 'case-files'
      and name like '%/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/%'
  $$,
  $$values (0::bigint)$$,
  'another user cannot list the first user documents'
);

select lives_ok(
  $$
    delete from storage.objects
    where bucket_id = 'case-files'
      and name like '%/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/%'
  $$,
  'another user delete attempt safely affects no documents'
);

reset role;

select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'case-files'
      and name like '%/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/%'
  ),
  2::bigint,
  'cross-user deletion leaves the owner documents intact'
);

set local role authenticated;
set local request.jwt.claim.sub = '51111111-1111-4111-8111-111111111111';

select lives_ok(
  $$
    delete from storage.objects
    where bucket_id = 'case-files'
      and name like '%/diminished-value/50000000-0000-4000-8000-000000000001.pdf'
  $$,
  'the owner can remove an exact document while the case is draft'
);

select lives_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    values (
      'case-files',
      '51111111-1111-4111-8111-111111111111/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/50000000-0000-4000-8000-000000000004.pdf',
      '{"originalName":"replacement-estimate.pdf"}'::jsonb
    )
  $$,
  'a removed draft document can be replaced by a new UUID object'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values (
      'case-files',
      '51111111-1111-4111-8111-111111111111/5ccccccc-cccc-4ccc-8ccc-ccccccccccc3/supporting.pdf'
    )
  $$,
  '42501',
  null,
  'integrated policies reject arbitrary Total-Loss objects while preserving Diminished Value documents'
);

select lives_ok(
  $$
    insert into pg_temp.diminished_value_submission_receipts
    select
      'storage-case',
      submission.case_id,
      submission.status,
      submission.submitted_at,
      submission.revision
    from public.submit_diminished_value_case(
      '5fffffff-ffff-4fff-8fff-fffffffffff6'
    ) as submission
  $$,
  'a draft with persisted documents can be submitted'
);

select is(
  public.authorize_diminished_value_document_mutation(
    '51111111-1111-4111-8111-111111111111/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/50000000-0000-4000-8000-000000000004.pdf'
  ),
  false,
  'document mutation authorization closes immediately after submission'
);

select results_eq(
  $$
    select count(*)
    from storage.objects
    where bucket_id = 'case-files'
      and name like '%/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/%'
  $$,
  $$values (2::bigint)$$,
  'submitted documents remain privately readable to their owner'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name, user_metadata)
    values (
      'case-files',
      '51111111-1111-4111-8111-111111111111/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/50000000-0000-4000-8000-000000000005.pdf',
      '{"originalName":"late-document.pdf"}'::jsonb
    )
  $$,
  '42501',
  null,
  'a submitted case rejects new documents'
);

select results_eq(
  $$
    with removed as (
      delete from storage.objects
      where bucket_id = 'case-files'
        and name like '%/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/%'
      returning 1
    )
    select count(*) from removed
  $$,
  $$values (0::bigint)$$,
  'a submitted case rejects document deletion'
);

select results_eq(
  $$
    with changed as (
      update storage.objects
      set user_metadata = '{"originalName":"changed.pdf"}'::jsonb
      where bucket_id = 'case-files'
        and name like '%/5fffffff-ffff-4fff-8fff-fffffffffff6/diminished-value/%'
      returning 1
    )
    select count(*) from changed
  $$,
  $$values (0::bigint)$$,
  'a submitted case rejects document metadata replacement'
);

select * from finish();
rollback;
