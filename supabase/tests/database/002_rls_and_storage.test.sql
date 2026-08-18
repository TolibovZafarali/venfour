begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(29);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'case-user-one@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'case-user-two@example.test');

insert into public.appraisal_cases (
  id,
  user_id,
  service_type,
  last_activity_at
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '11111111-1111-4111-8111-111111111111',
    'total_loss',
    '2000-01-01 00:00:00+00'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '22222222-2222-4222-8222-222222222222',
    'diminished_value',
    '2000-01-01 00:00:00+00'
  );

select is(
  (select count(*) from public.profiles where id in (
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222'
  )),
  2::bigint,
  'the auth trigger creates one profile per new user'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select results_eq(
  $$select user_id from public.appraisal_cases order by user_id$$,
  $$values ('11111111-1111-4111-8111-111111111111'::uuid)$$,
  'user one can read only their own cases'
);

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

select results_eq(
  $$select user_id from public.appraisal_cases order by user_id$$,
  $$values ('22222222-2222-4222-8222-222222222222'::uuid)$$,
  'user two can read only their own cases'
);

set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select lives_ok(
  $$
    insert into public.appraisal_cases (user_id, service_type)
    values ('11111111-1111-4111-8111-111111111111', 'diminished_value')
  $$,
  'an authenticated customer can create their own case'
);

select results_eq(
  $$
    select count(*)
    from public.appraisal_cases
    where user_id = '11111111-1111-4111-8111-111111111111'
      and service_type = 'diminished_value'
      and status = 'draft'
  $$,
  array[1::bigint],
  'a browser-created case receives the server default draft status'
);

select throws_ok(
  $$
    insert into public.appraisal_cases (user_id, service_type)
    values ('22222222-2222-4222-8222-222222222222', 'total_loss')
  $$,
  '42501',
  null,
  'a customer cannot create a case for another user'
);

select throws_ok(
  $$
    insert into public.appraisal_cases (user_id, service_type, status)
    values ('11111111-1111-4111-8111-111111111111', 'total_loss', 'paid')
  $$,
  '42501',
  null,
  'a browser client cannot provide status during case creation'
);

select throws_ok(
  $$
    update public.appraisal_cases
    set status = 'paid'
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '42501',
  null,
  'a browser client cannot update case status'
);

select throws_ok(
  $$
    update public.appraisal_cases
    set user_id = '22222222-2222-4222-8222-222222222222'
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  '42501',
  null,
  'a browser client cannot transfer case ownership'
);

select lives_ok(
  $$
    update public.profiles
    set display_name = 'Customer One'
    where id = '11111111-1111-4111-8111-111111111111'
  $$,
  'a customer can update their own display name'
);

select lives_ok(
  $$
    update public.profiles
    set display_name = 'Not Customer Two'
    where id = '22222222-2222-4222-8222-222222222222'
  $$,
  'a cross-user profile update is safely reduced to no rows'
);

reset role;

select is(
  (select display_name from public.profiles where id = '22222222-2222-4222-8222-222222222222'),
  null::text,
  'a customer cannot alter another customer profile'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select lives_ok(
  $$select public.touch_appraisal_case('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1')$$,
  'touch_appraisal_case accepts an owned case'
);

reset role;

select ok(
  (
    select last_activity_at > '2000-01-01 00:00:00+00'::timestamptz
    from public.appraisal_cases
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  ),
  'touch_appraisal_case uses database time for the owned case'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select is(
  (
    select (public.touch_appraisal_case(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
    )).id
  ),
  null::uuid,
  'touch_appraisal_case does not return or update an unowned case'
);

reset role;
set local role service_role;

select lives_ok(
  $$
    update public.appraisal_cases
    set status = 'paid'
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  $$,
  'a trusted service workflow can transition status'
);

reset role;

select is(
  (select status::text from public.appraisal_cases where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  'paid',
  'the trusted status transition is persisted'
);

set local role anon;

select throws_ok(
  $$select * from public.appraisal_cases$$,
  '42501',
  null,
  'anonymous clients cannot query customer cases'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select lives_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values (
      'case-files',
      '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/valuation.pdf'
    )
  $$,
  'a customer can add a file below their owned case path'
);

select results_eq(
  $$
    select count(*)
    from storage.objects
    where bucket_id = 'case-files'
  $$,
  array[1::bigint],
  'a customer can read their owned case file'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values (
      'case-files',
      '22222222-2222-4222-8222-222222222222/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/wrong-namespace.pdf'
    )
  $$,
  '42501',
  null,
  'a customer cannot write into another user namespace'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values (
      'case-files',
      '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2/unowned-case.pdf'
    )
  $$,
  '42501',
  null,
  'a customer cannot write below a case they do not own'
);

select throws_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values ('case-files', '11111111-1111-4111-8111-111111111111/malformed.pdf')
  $$,
  '42501',
  null,
  'a storage object path must include an owned case ID'
);

select throws_ok(
  $$
    update storage.objects
    set name = '22222222-2222-4222-8222-222222222222/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2/moved.pdf'
    where bucket_id = 'case-files'
      and name = '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/valuation.pdf'
  $$,
  '42501',
  null,
  'a customer cannot move a file across ownership boundaries'
);

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

select results_eq(
  $$select count(*) from storage.objects where bucket_id = 'case-files'$$,
  array[0::bigint],
  'another customer cannot see the first customer file'
);

select lives_ok(
  $$delete from storage.objects where bucket_id = 'case-files'$$,
  'another customer delete attempt is safely reduced to no rows'
);

reset role;

select is(
  (
    select count(*)
    from storage.objects
    where bucket_id = 'case-files'
      and name = '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/valuation.pdf'
  ),
  1::bigint,
  'another customer cannot delete the first customer file'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select lives_ok(
  $$
    delete from storage.objects
    where bucket_id = 'case-files'
      and name = '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/valuation.pdf'
  $$,
  'a customer can delete their own case file'
);

reset role;

select is(
  (select count(*) from storage.objects where bucket_id = 'case-files'),
  0::bigint,
  'the owned case file was deleted'
);

select * from finish();
rollback;
