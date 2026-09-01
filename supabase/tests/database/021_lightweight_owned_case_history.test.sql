begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(5);

insert into auth.users (id, email, email_confirmed_at, is_anonymous)
values
  (
    '21000000-0000-4000-8000-000000000001',
    'owned-history@example.test',
    statement_timestamp(),
    false
  ),
  (
    '21000000-0000-4000-8000-000000000002',
    'other-history@example.test',
    statement_timestamp(),
    false
  );

insert into public.appraisal_cases (
  id,
  user_id,
  service_type,
  status,
  created_at,
  updated_at,
  last_activity_at
)
values
  (
    '22000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    'total_loss',
    'draft',
    '2026-08-01T12:00:00Z',
    '2026-08-01T12:00:00Z',
    '2026-08-01T12:00:00Z'
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000001',
    'total_loss',
    'draft',
    '2026-08-02T12:00:00Z',
    '2026-08-02T12:00:00Z',
    '2026-08-02T12:00:00Z'
  ),
  (
    '22000000-0000-4000-8000-000000000003',
    '21000000-0000-4000-8000-000000000002',
    'total_loss',
    'draft',
    '2026-08-03T12:00:00Z',
    '2026-08-03T12:00:00Z',
    '2026-08-03T12:00:00Z'
  );

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 's'
      and 'search_path=""' = any(procedure.proconfig)
    from pg_proc as procedure
    where procedure.oid =
      'public.list_owned_case_operations()'::regprocedure
  ),
  'the lightweight owner list remains stable, pinned, and SECURITY DEFINER'
);

select ok(
  (
    select pg_get_functiondef(procedure.oid)
      not like '%resolve_total_loss_case_claim%'
      and pg_get_functiondef(procedure.oid)
        like '%public.total_loss_claim_workflows%'
      and pg_get_functiondef(procedure.oid)
        not like '%newer_draft%'
    from pg_proc as procedure
    where procedure.oid =
      'public.list_owned_case_operations()'::regprocedure
  ),
  'the list uses a direct workflow-existence check without rich resolution or draft suppression'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '21000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$
    select
      case_id,
      case_stage::text,
      has_total_loss_claim_workflow
    from public.list_owned_case_operations()
    where case_id in (
      '22000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000002'
    )
    order by case_id
  $$,
  $$
    values
      (
        '22000000-0000-4000-8000-000000000001'::uuid,
        'intake_not_started'::text,
        false
      ),
      (
        '22000000-0000-4000-8000-000000000002'::uuid,
        'intake_not_started'::text,
        false
      )
  $$,
  'the owner list returns both an older legitimate draft and a newer owned draft'
);

select is(
  (
    select count(*)
    from public.list_owned_case_operations()
    where case_id = '22000000-0000-4000-8000-000000000003'
  ),
  0::bigint,
  'the owner list does not leak another customer case'
);

select results_eq(
  $$
    select case_id
    from public.list_owned_case_operations()
    where case_id in (
      '22000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000002'
    )
    order by last_activity_at desc, case_id desc
  $$,
  $$
    values
      ('22000000-0000-4000-8000-000000000002'::uuid),
      ('22000000-0000-4000-8000-000000000001'::uuid)
  $$,
  'complete history retains newest-first activity ordering'
);

select * from finish();
rollback;
