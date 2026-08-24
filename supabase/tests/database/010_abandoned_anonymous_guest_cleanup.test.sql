begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(53);

select ok(
  to_regclass('public.anonymous_guest_cleanup_runs') is not null
    and to_regclass('public.anonymous_guest_cleanup_candidates') is not null
    and to_regclass('public.anonymous_guest_cleanup_events') is not null
    and to_regclass(
      'public.anonymous_guest_cleanup_scheduler_config'
    ) is not null,
  'private cleanup audit and scheduler-destination tables exist'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.anonymous_guest_cleanup_runs'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.anonymous_guest_cleanup_candidates'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.anonymous_guest_cleanup_events'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.anonymous_guest_cleanup_scheduler_config'::regclass),
  'all cleanup and scheduler-config tables have RLS enabled'
);

select ok(
  to_regprocedure(
    'public.begin_abandoned_anonymous_guest_cleanup_run(boolean,integer)'
  ) is not null
    and to_regprocedure(
      'public.claim_abandoned_anonymous_guest_cleanup_candidate(uuid,uuid)'
    ) is not null
    and to_regprocedure(
      'public.start_abandoned_anonymous_guest_storage_deletion(uuid,uuid)'
    ) is not null
    and to_regprocedure(
      'public.mark_abandoned_anonymous_guest_storage_deleted(uuid,uuid)'
    ) is not null
    and to_regprocedure(
      'public.complete_abandoned_anonymous_guest_cleanup_candidate(uuid,uuid)'
    ) is not null,
  'the cleanup lifecycle RPC signatures are stable'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.begin_abandoned_anonymous_guest_cleanup_run(boolean,integer)',
    'EXECUTE'
  )
    and has_function_privilege(
      'service_role',
      'public.claim_abandoned_anonymous_guest_cleanup_candidate(uuid,uuid)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.complete_abandoned_anonymous_guest_cleanup_candidate(uuid,uuid)',
      'EXECUTE'
    ),
  'service_role can use only the bounded cleanup RPC surface'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.begin_abandoned_anonymous_guest_cleanup_run(boolean,integer)',
    'EXECUTE'
  )
    and not has_function_privilege(
      'anon',
      'public.claim_abandoned_anonymous_guest_cleanup_candidate(uuid,uuid)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'service_role',
      'public.is_abandoned_anonymous_guest_eligible(uuid,timestamptz)',
      'EXECUTE'
    ),
  'browser roles and service_role cannot invoke internal eligibility helpers'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.anonymous_guest_cleanup_candidates',
    'SELECT'
  )
    and not has_table_privilege(
      'authenticated',
      'public.anonymous_guest_cleanup_events',
      'SELECT'
    )
    and not has_table_privilege(
      'service_role',
      'public.anonymous_guest_cleanup_scheduler_config',
      'SELECT'
    ),
  'cleanup queue, audit, and scheduler config have no direct API table surface'
);

select results_eq(
  $$
    select jobname, schedule, command
    from cron.job
    where jobname = 'venfour-abandoned-anonymous-guest-cleanup-daily'
  $$,
  $$
    values (
      'venfour-abandoned-anonymous-guest-cleanup-daily'::text,
      '17 3 * * *'::text,
      'select public.invoke_abandoned_anonymous_guest_cleanup();'::text
    )
  $$,
  'one named UTC daily cron job invokes the Vault-backed dispatcher'
);

select ok(
  position(
    'venfour_cleanup_edge_function_url'
    in pg_get_functiondef(
      'public.invoke_abandoned_anonymous_guest_cleanup()'::regprocedure
    )
  ) > 0
    and position(
      'venfour_cleanup_schedule_secret'
      in pg_get_functiondef(
        'public.invoke_abandoned_anonymous_guest_cleanup()'::regprocedure
      )
    ) > 0
    and position(
      'service_role'
      in pg_get_functiondef(
        'public.invoke_abandoned_anonymous_guest_cleanup()'::regprocedure
      )
    ) = 0,
  'the cron dispatcher keeps credentials in Vault and contains no service-role key'
);

select results_eq(
  $$
    select singleton, project_origin
    from public.anonymous_guest_cleanup_scheduler_config
  $$,
  $$
    values (
      true,
      'https://bjvsgaqitehtwasugvla.supabase.co'::text
    )
  $$,
  'the non-secret scheduler fence is pinned to the exact linked Supabase origin'
);

delete from vault.secrets
where name = 'venfour_cleanup_edge_function_url';

do $$
begin
  perform vault.create_secret(
    'https://off-project.example/functions/v1/cleanup-abandoned-anonymous-guests',
    'venfour_cleanup_edge_function_url',
    'pgTAP off-project cleanup destination'
  );
end;
$$;

select throws_ok(
  $$select public.invoke_abandoned_anonymous_guest_cleanup()$$,
  '55000',
  'The anonymous cleanup Edge Function URL does not match the configured Supabase project.',
  'the scheduler rejects the correct function path on every off-project host'
);

delete from vault.secrets
where name = 'venfour_cleanup_edge_function_url';

do $$
begin
  perform vault.create_secret(
    'https://bjvsgaqitehtwasugvla.supabase.co/functions/v1/not-the-cleanup-function',
    'venfour_cleanup_edge_function_url',
    'pgTAP wrong-path cleanup destination'
  );
end;
$$;

select throws_ok(
  $$select public.invoke_abandoned_anonymous_guest_cleanup()$$,
  '55000',
  'The anonymous cleanup Edge Function URL does not match the configured Supabase project.',
  'the scheduler rejects every non-canonical path on the linked project host'
);

delete from vault.secrets
where name = 'venfour_cleanup_edge_function_url';

insert into auth.users (
  id,
  email,
  email_confirmed_at,
  is_anonymous,
  created_at,
  updated_at,
  last_sign_in_at
)
values
  (
    'a1111111-1111-4111-8111-111111111111',
    null,
    null,
    true,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'a2222222-2222-4222-8222-222222222222',
    null,
    null,
    true,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'a3333333-3333-4333-8333-333333333333',
    null,
    null,
    true,
    statement_timestamp() - interval '45 days',
    statement_timestamp(),
    statement_timestamp()
  ),
  (
    'a4444444-4444-4444-8444-444444444444',
    'permanent-cleanup@example.test',
    statement_timestamp() - interval '45 days',
    false,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'a5555555-5555-4555-8555-555555555555',
    null,
    null,
    true,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'a6666666-6666-4666-8666-666666666666',
    null,
    null,
    true,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'a7777777-7777-4777-8777-777777777777',
    null,
    null,
    true,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'a8888888-8888-4888-8888-888888888888',
    null,
    null,
    true,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'a9999999-9999-4999-8999-999999999999',
    null,
    null,
    true,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'aa111111-1111-4111-8111-111111111111',
    null,
    null,
    true,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'ab111111-1111-4111-8111-111111111111',
    'transfer-owner@example.test',
    statement_timestamp() - interval '45 days',
    false,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'ac111111-1111-4111-8111-111111111111',
    null,
    null,
    true,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'ad111111-1111-4111-8111-111111111111',
    null,
    null,
    true,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'af111111-1111-4111-8111-111111111111',
    null,
    null,
    true,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  );

alter table public.profiles disable trigger profiles_set_updated_at;

update public.profiles
set
  created_at = statement_timestamp() - interval '45 days',
  updated_at = statement_timestamp() - interval '45 days'
where id <> 'a3333333-3333-4333-8333-333333333333'
  and id in (
    'a1111111-1111-4111-8111-111111111111',
    'a2222222-2222-4222-8222-222222222222',
    'a4444444-4444-4444-8444-444444444444',
    'a5555555-5555-4555-8555-555555555555',
    'a6666666-6666-4666-8666-666666666666',
    'a7777777-7777-4777-8777-777777777777',
    'a8888888-8888-4888-8888-888888888888',
    'a9999999-9999-4999-8999-999999999999',
    'aa111111-1111-4111-8111-111111111111',
    'ab111111-1111-4111-8111-111111111111',
    'ac111111-1111-4111-8111-111111111111',
    'ad111111-1111-4111-8111-111111111111',
    'af111111-1111-4111-8111-111111111111'
  );

alter table public.profiles enable trigger profiles_set_updated_at;

insert into public.staff_members (user_id)
values ('a5555555-5555-4555-8555-555555555555');

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
    'b2222222-2222-4222-8222-222222222222',
    'a2222222-2222-4222-8222-222222222222',
    'total_loss',
    'draft',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'b6666666-6666-4666-8666-666666666666',
    'a6666666-6666-4666-8666-666666666666',
    'total_loss',
    'submitted',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'b7777777-7777-4777-8777-777777777777',
    'a7777777-7777-4777-8777-777777777777',
    'total_loss',
    'draft',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'b8888888-8888-4888-8888-888888888888',
    'a8888888-8888-4888-8888-888888888888',
    'total_loss',
    'draft',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'b9999999-9999-4999-8999-999999999999',
    'a9999999-9999-4999-8999-999999999999',
    'total_loss',
    'draft',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'ba111111-1111-4111-8111-111111111111',
    'aa111111-1111-4111-8111-111111111111',
    'total_loss',
    'draft',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'bb111111-1111-4111-8111-111111111111',
    'ac111111-1111-4111-8111-111111111111',
    'total_loss',
    'draft',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'bc111111-1111-4111-8111-111111111111',
    'ad111111-1111-4111-8111-111111111111',
    'total_loss',
    'draft',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  );

insert into public.total_loss_case_details (
  case_id,
  intake_mode,
  intake_completed_at,
  report_upload_id,
  report_upload_expires_at,
  report_upload_details_updated_at,
  report_upload_phase,
  created_at,
  updated_at
)
values
  (
    'b2222222-2222-4222-8222-222222222222',
    'manual',
    null,
    null,
    null,
    null,
    null,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'b7777777-7777-4777-8777-777777777777',
    'manual',
    statement_timestamp() - interval '40 days',
    null,
    null,
    null,
    null,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'b8888888-8888-4888-8888-888888888888',
    'manual',
    null,
    null,
    null,
    null,
    null,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'bb111111-1111-4111-8111-111111111111',
    'manual',
    null,
    null,
    null,
    null,
    null,
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  ),
  (
    'bc111111-1111-4111-8111-111111111111',
    'report',
    null,
    'bd111111-1111-4111-8111-111111111111',
    statement_timestamp() + interval '1 day',
    statement_timestamp() - interval '45 days',
    'preparing',
    statement_timestamp() - interval '45 days',
    statement_timestamp() - interval '45 days'
  );

insert into public.total_loss_analysis_jobs (
  case_id,
  source_report_upload_id,
  source_details_updated_at,
  status,
  processing_token,
  processing_expires_at,
  source_intake_mode,
  source_analysis_input_revision,
  source_analysis_input_id
)
select
  details.case_id,
  null,
  details.updated_at,
  'processing',
  'be111111-1111-4111-8111-111111111111',
  statement_timestamp() + interval '1 day',
  'manual',
  details.analysis_input_revision,
  details.analysis_input_id
from public.total_loss_case_details as details
where details.case_id = 'b8888888-8888-4888-8888-888888888888';

insert into public.total_loss_case_identity_claims (
  id,
  case_id,
  source_user_id,
  requested_email,
  expires_at,
  created_at
)
values (
  'bf111111-1111-4111-8111-111111111111',
  'b9999999-9999-4999-8999-999999999999',
  'a9999999-9999-4999-8999-999999999999',
  'active-claim@example.test',
  statement_timestamp() + interval '1 day',
  statement_timestamp() - interval '45 days'
);

insert into public.total_loss_case_identity_claims (
  id,
  case_id,
  source_user_id,
  requested_email,
  expires_at,
  claimed_by_user_id,
  claimed_at,
  created_at
)
values (
  'c0111111-1111-4111-8111-111111111111',
  'ba111111-1111-4111-8111-111111111111',
  'aa111111-1111-4111-8111-111111111111',
  'claimed-cleanup@example.test',
  statement_timestamp() - interval '43 days',
  'a4444444-4444-4444-8444-444444444444',
  statement_timestamp() - interval '44 days',
  statement_timestamp() - interval '45 days'
);

update public.appraisal_cases
set user_id = 'ab111111-1111-4111-8111-111111111111'
where id = 'bb111111-1111-4111-8111-111111111111';

select ok(
  public.is_abandoned_anonymous_guest_eligible(
    'a1111111-1111-4111-8111-111111111111',
    statement_timestamp()
  ),
  'an old anonymous user with no valuable state is eligible'
);

select ok(
  public.is_abandoned_anonymous_guest_eligible(
    'a2222222-2222-4222-8222-222222222222',
    statement_timestamp()
  ),
  'an old anonymous user with only an inactive Total-Loss draft is eligible'
);

insert into storage.objects (bucket_id, name, user_metadata)
values (
  'case-files',
  'a2222222-2222-4222-8222-222222222222/b2222222-2222-4222-8222-222222222222/valuation-report.pdf',
  '{}'::jsonb
);

select ok(
  not public.is_abandoned_anonymous_guest_eligible(
    'a2222222-2222-4222-8222-222222222222',
    statement_timestamp()
  ),
  'recent private Storage activity protects an otherwise old guest draft'
);

-- Hosted Supabase Storage sets this transaction-local guard while its API
-- removes object metadata. The cleanup executor uses that API, never direct
-- production SQL deletion; the test toggles the same guard only for fixtures.
set local storage.allow_delete_query = 'true';

delete from storage.objects
where bucket_id = 'case-files'
  and name = 'a2222222-2222-4222-8222-222222222222/b2222222-2222-4222-8222-222222222222/valuation-report.pdf';

set local storage.allow_delete_query = 'false';

select ok(
  not public.is_abandoned_anonymous_guest_eligible(
    'a3333333-3333-4333-8333-333333333333',
    statement_timestamp()
  ),
  'recent Auth activity protects an anonymous user'
);

select ok(
  not public.is_abandoned_anonymous_guest_eligible(
    'a4444444-4444-4444-8444-444444444444',
    statement_timestamp()
  ),
  'a permanent user is never eligible even when old'
);

select ok(
  not public.is_abandoned_anonymous_guest_eligible(
    'a5555555-5555-4555-8555-555555555555',
    statement_timestamp()
  ),
  'database-authorized staff are never eligible'
);

select ok(
  not public.is_abandoned_anonymous_guest_eligible(
    'a6666666-6666-4666-8666-666666666666',
    statement_timestamp()
  ),
  'a submitted case is never eligible'
);

select ok(
  not public.is_abandoned_anonymous_guest_eligible(
    'a7777777-7777-4777-8777-777777777777',
    statement_timestamp()
  ),
  'a completed intake is protected even while its parent remains draft'
);

select ok(
  not public.is_abandoned_anonymous_guest_eligible(
    'a8888888-8888-4888-8888-888888888888',
    statement_timestamp()
  ),
  'any analysis job, including processing, protects its case owner'
);

select ok(
  not public.is_abandoned_anonymous_guest_eligible(
    'a9999999-9999-4999-8999-999999999999',
    statement_timestamp()
  ),
  'an active case-claim flow protects its guest owner'
);

select ok(
  not public.is_abandoned_anonymous_guest_eligible(
    'aa111111-1111-4111-8111-111111111111',
    statement_timestamp()
  ),
  'a consumed ownership claim protects the source guest audit identity'
);

select ok(
  not public.is_abandoned_anonymous_guest_eligible(
    'ac111111-1111-4111-8111-111111111111',
    statement_timestamp()
  ),
  'a transferred case retaining the guest report namespace protects that source guest'
);

select ok(
  not public.is_abandoned_anonymous_guest_eligible(
    'ad111111-1111-4111-8111-111111111111',
    statement_timestamp()
  ),
  'an active report-upload lease is explicitly protected regardless of old detail timestamps'
);

create temporary table cleanup_test_runs (
  phase text primary key,
  run_id uuid,
  run_status text,
  eligible_count integer,
  marked_count integer,
  cancelled_count integer
);

grant select, insert, update on cleanup_test_runs to service_role;

set local role service_role;

insert into cleanup_test_runs
select
  'dry',
  run_id,
  run_status,
  eligible_count,
  marked_count,
  cancelled_count
from public.begin_abandoned_anonymous_guest_cleanup_run(true, 25);

reset role;

select results_eq(
  $$
    select run_status, eligible_count, marked_count
    from cleanup_test_runs
    where phase = 'dry'
  $$,
  $$values ('completed'::text, 3, 0)$$,
  'dry-run reports eligible users without marking them'
);

select is(
  (select count(*) from public.anonymous_guest_cleanup_candidates),
  0::bigint,
  'dry-run leaves the durable candidate queue untouched'
);

select is(
  (
    select count(*)
    from public.anonymous_guest_cleanup_events
    where run_id = (select run_id from cleanup_test_runs where phase = 'dry')
      and event_type = 'dry_run_completed'
  ),
  1::bigint,
  'dry-run writes one bounded audit event'
);

set local role service_role;

insert into cleanup_test_runs
select
  'real',
  run_id,
  run_status,
  eligible_count,
  marked_count,
  cancelled_count
from public.begin_abandoned_anonymous_guest_cleanup_run(false, 25);

reset role;

select results_eq(
  $$
    select run_status, eligible_count, marked_count
    from cleanup_test_runs
    where phase = 'real'
  $$,
  $$values ('running'::text, 3, 3)$$,
  'a real run marks the bounded eligible set'
);

select is(
  (
    select count(*)
    from public.anonymous_guest_cleanup_candidates
    where state = 'grace'
      and delete_after >= first_marked_at + interval '24 hours'
  ),
  3::bigint,
  'every newly marked candidate receives at least 24 hours of grace'
);

update public.anonymous_guest_cleanup_candidates
set
  first_marked_at = statement_timestamp() - interval '48 hours',
  delete_after = statement_timestamp() - interval '24 hours'
where user_id = 'af111111-1111-4111-8111-111111111111';

update auth.users
set updated_at = statement_timestamp()
where id = 'af111111-1111-4111-8111-111111111111';

set local role service_role;

select is(
  (
    select count(*)
    from public.claim_abandoned_anonymous_guest_cleanup_candidate(
      (select run_id from cleanup_test_runs where phase = 'real'),
      'c0111111-1111-4111-8111-111111111111'
    )
  ),
  0::bigint,
  'claim-time revalidation returns no work after eligibility changes during grace'
);

reset role;

select results_eq(
  $$
    select
      candidate.state,
      candidate.last_error_code,
      count(cleanup_event.id)
    from public.anonymous_guest_cleanup_candidates as candidate
    left join public.anonymous_guest_cleanup_events as cleanup_event
      on cleanup_event.user_id = candidate.user_id
      and cleanup_event.event_type = 'candidate_cancelled'
      and cleanup_event.run_id = (
        select run_id from cleanup_test_runs where phase = 'real'
      )
    where candidate.user_id = 'af111111-1111-4111-8111-111111111111'
    group by candidate.state, candidate.last_error_code
  $$,
  $$values ('cancelled'::text, 'NO_LONGER_ELIGIBLE'::text, 1::bigint)$$,
  'claim-time eligibility loss is durably cancelled and journaled'
);

set local role service_role;

select is(
  (
    select count(*)
    from public.claim_abandoned_anonymous_guest_cleanup_candidate(
      (select run_id from cleanup_test_runs where phase = 'real'),
      'c1111111-1111-4111-8111-111111111111'
    )
  ),
  0::bigint,
  'no candidate can be claimed before its grace period expires'
);

reset role;

update public.anonymous_guest_cleanup_candidates
set
  first_marked_at = statement_timestamp() - interval '48 hours',
  delete_after = statement_timestamp() - interval '24 hours'
where user_id = 'a2222222-2222-4222-8222-222222222222';

create temporary table cleanup_claim as
select
  null::uuid as user_id,
  null::text as cleanup_action,
  array[]::uuid[] as case_ids,
  array[]::text[] as storage_prefixes,
  array[]::text[] as storage_object_paths
with no data;

grant select, insert on cleanup_claim to service_role;

set local role service_role;

insert into cleanup_claim
select *
from public.claim_abandoned_anonymous_guest_cleanup_candidate(
  (select run_id from cleanup_test_runs where phase = 'real'),
  'c2222222-2222-4222-8222-222222222222'
);

reset role;

select results_eq(
  $$
    select
      user_id,
      cleanup_action,
      case_ids,
      storage_prefixes,
      storage_object_paths
    from cleanup_claim
  $$,
  $$
    values (
      'a2222222-2222-4222-8222-222222222222'::uuid,
      'delete_storage'::text,
      array['b2222222-2222-4222-8222-222222222222'::uuid],
      array[
        'a2222222-2222-4222-8222-222222222222/b2222222-2222-4222-8222-222222222222'
      ]::text[],
      array[
        'a2222222-2222-4222-8222-222222222222/b2222222-2222-4222-8222-222222222222/valuation-report-backup.pdf',
        'a2222222-2222-4222-8222-222222222222/b2222222-2222-4222-8222-222222222222/valuation-report.pdf'
      ]::text[]
    )
  $$,
  'claim snapshots only exact canonical and backup paths in the immutable owned namespace'
);

select ok(
  public.anonymous_guest_cleanup_user_frozen(
    'a2222222-2222-4222-8222-222222222222'
  ),
  'an executing candidate is frozen against concurrent mutation'
);

set local role authenticated;
set local request.jwt.claim.sub = 'a2222222-2222-4222-8222-222222222222';

select throws_ok(
  $$
    update public.profiles
    set display_name = 'Race Cleanup'
    where id = 'a2222222-2222-4222-8222-222222222222'
  $$,
  '55000',
  'This anonymous guest is being retired. Mutations are temporarily disabled.',
  'the cleanup fence blocks a customer profile mutation after claim'
);

reset role;

select throws_ok(
  $$
    update auth.users
    set is_anonymous = false
    where id = 'a2222222-2222-4222-8222-222222222222'
  $$,
  '55000',
  'This anonymous guest is being retired. Mutations are temporarily disabled.',
  'the cleanup fence blocks permanent-identity conversion after claim'
);

insert into storage.objects (bucket_id, name, user_metadata)
values
  (
    'case-files',
    'a2222222-2222-4222-8222-222222222222/b2222222-2222-4222-8222-222222222222/valuation-report.pdf',
    '{}'::jsonb
  ),
  (
    'case-files',
    'a2222222-2222-4222-8222-222222222222/orphan-folder/unexpected.pdf',
    '{}'::jsonb
  );

set local role service_role;

select lives_ok(
  $$
    select public.start_abandoned_anonymous_guest_storage_deletion(
      'a2222222-2222-4222-8222-222222222222',
      'c2222222-2222-4222-8222-222222222222'
    )
  $$,
  'the leased Edge workflow can durably mark Storage deletion as started'
);

select throws_ok(
  $$
    select public.mark_abandoned_anonymous_guest_storage_deleted(
      'a2222222-2222-4222-8222-222222222222',
      'c2222222-2222-4222-8222-222222222222'
    )
  $$,
  '55000',
  'The cleanup storage completion lease is no longer valid.',
  'Storage completion cannot advance while snapshotted or orphan objects remain'
);

reset role;

set local storage.allow_delete_query = 'true';

delete from storage.objects
where bucket_id = 'case-files'
  and name like 'a2222222-2222-4222-8222-222222222222/%valuation-report.pdf';

set local storage.allow_delete_query = 'false';

set local role service_role;

select throws_ok(
  $$
    select public.mark_abandoned_anonymous_guest_storage_deleted(
      'a2222222-2222-4222-8222-222222222222',
      'c2222222-2222-4222-8222-222222222222'
    )
  $$,
  '55000',
  'The cleanup storage completion lease is no longer valid.',
  'an unexpected root folder independently blocks Auth-deletion readiness'
);

reset role;

set local storage.allow_delete_query = 'true';

delete from storage.objects
where bucket_id = 'case-files'
  and name = 'a2222222-2222-4222-8222-222222222222/orphan-folder/unexpected.pdf';

set local storage.allow_delete_query = 'false';

set local role service_role;

select lives_ok(
  $$
    select public.mark_abandoned_anonymous_guest_storage_deleted(
      'a2222222-2222-4222-8222-222222222222',
      'c2222222-2222-4222-8222-222222222222'
    )
  $$,
  'Storage can be marked deleted only after the entire candidate root is empty'
);

select throws_ok(
  $$
    select public.complete_abandoned_anonymous_guest_cleanup_candidate(
      'a2222222-2222-4222-8222-222222222222',
      'c2222222-2222-4222-8222-222222222222'
    )
  $$,
  '55000',
  'Auth deletion has not completed.',
  'database completion refuses to run before Auth deletion'
);

reset role;

delete from auth.users
where id = 'a2222222-2222-4222-8222-222222222222';

set local role service_role;

select lives_ok(
  $$
    select public.complete_abandoned_anonymous_guest_cleanup_candidate(
      'a2222222-2222-4222-8222-222222222222',
      'c2222222-2222-4222-8222-222222222222'
    )
  $$,
  'the audit can complete after Storage verification and Auth hard deletion'
);

reset role;

select results_eq(
  $$
    select state, storage_deleted_at is not null, auth_deleted_at is not null
    from public.anonymous_guest_cleanup_candidates
    where user_id = 'a2222222-2222-4222-8222-222222222222'
  $$,
  $$values ('completed'::text, true, true)$$,
  'the candidate audit survives Auth and case cascades in completed state'
);

select is(
  (
    select count(*)
    from public.anonymous_guest_cleanup_events
    where user_id = 'a2222222-2222-4222-8222-222222222222'
      and event_type = 'candidate_completed'
  ),
  1::bigint,
  'successful retirement writes exactly one completion event'
);

update public.anonymous_guest_cleanup_candidates
set
  first_marked_at = statement_timestamp() - interval '48 hours',
  delete_after = statement_timestamp() - interval '24 hours'
where user_id = 'a1111111-1111-4111-8111-111111111111';

set local role service_role;

select is(
  (
    select cleanup_action
    from public.claim_abandoned_anonymous_guest_cleanup_candidate(
      (select run_id from cleanup_test_runs where phase = 'real'),
      'c3111111-1111-4111-8111-111111111111'
    )
  ),
  'delete_storage'::text,
  'an orphan Auth-only candidate enters the same Storage-first state machine'
);

select lives_ok(
  $$
    select public.start_abandoned_anonymous_guest_storage_deletion(
      'a1111111-1111-4111-8111-111111111111',
      'c3111111-1111-4111-8111-111111111111'
    )
  $$,
  'an empty namespace still records the Storage phase before Auth deletion'
);

select lives_ok(
  $$
    select public.retry_abandoned_anonymous_guest_cleanup_candidate(
      'a1111111-1111-4111-8111-111111111111',
      'c3111111-1111-4111-8111-111111111111',
      'STORAGE_DELETE_FAILED'
    )
  $$,
  'an interrupted Storage phase transitions to a durable retry state'
);

reset role;

select results_eq(
  $$
    select state, lease_token is null, retry_after is not null,
      public.anonymous_guest_cleanup_user_frozen(user_id)
    from public.anonymous_guest_cleanup_candidates
    where user_id = 'a1111111-1111-4111-8111-111111111111'
  $$,
  $$values ('storage_retry'::text, true, true, true)$$,
  'an interrupted candidate remains frozen and safely reclaimable'
);

update public.anonymous_guest_cleanup_candidates
set retry_after = statement_timestamp() - interval '1 minute'
where user_id = 'a1111111-1111-4111-8111-111111111111';

set local role service_role;

select is(
  (
    select cleanup_action
    from public.claim_abandoned_anonymous_guest_cleanup_candidate(
      (select run_id from cleanup_test_runs where phase = 'real'),
      'c4111111-1111-4111-8111-111111111111'
    )
  ),
  'delete_storage'::text,
  'a retry is reclaimed with a fresh fencing token'
);

select lives_ok(
  $$
    select public.start_abandoned_anonymous_guest_storage_deletion(
      'a1111111-1111-4111-8111-111111111111',
      'c4111111-1111-4111-8111-111111111111'
    );
    select public.mark_abandoned_anonymous_guest_storage_deleted(
      'a1111111-1111-4111-8111-111111111111',
      'c4111111-1111-4111-8111-111111111111'
    )
  $$,
  'the reclaimed lease can idempotently finish the empty Storage phase'
);

reset role;

delete from auth.users
where id = 'a1111111-1111-4111-8111-111111111111';

set local role service_role;

select lives_ok(
  $$
    select public.complete_abandoned_anonymous_guest_cleanup_candidate(
      'a1111111-1111-4111-8111-111111111111',
      'c4111111-1111-4111-8111-111111111111'
    )
  $$,
  'an interrupted candidate completes normally after retry and Auth deletion'
);

select lives_ok(
  $$
    select *
    from public.finish_abandoned_anonymous_guest_cleanup_run(
      (select run_id from cleanup_test_runs where phase = 'real'),
      false
    )
  $$,
  'the bounded cleanup run closes from its immutable event journal'
);

reset role;

select results_eq(
  $$
    select status, marked_count, cancelled_count, claimed_count,
      completed_count, retry_count, blocked_count
    from public.anonymous_guest_cleanup_runs
    where id = (select run_id from cleanup_test_runs where phase = 'real')
  $$,
  $$values ('completed'::text, 3, 1, 3, 2, 1, 0)$$,
  'finish recomputes cancellations and all terminal counters from the journal'
);

select * from finish();
rollback;
