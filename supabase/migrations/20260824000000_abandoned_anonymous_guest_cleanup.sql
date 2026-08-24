create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

create table public.anonymous_guest_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  dry_run boolean not null,
  requested_batch_size integer not null,
  status text not null default 'running',
  eligible_count integer not null default 0,
  marked_count integer not null default 0,
  cancelled_count integer not null default 0,
  claimed_count integer not null default 0,
  completed_count integer not null default 0,
  retry_count integer not null default 0,
  blocked_count integer not null default 0,
  started_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  constraint anonymous_guest_cleanup_runs_batch_valid
    check (requested_batch_size between 1 and 100),
  constraint anonymous_guest_cleanup_runs_status_valid
    check (status in ('running', 'completed', 'skipped', 'failed')),
  constraint anonymous_guest_cleanup_runs_terminal_state
    check (
      (status = 'running' and completed_at is null)
      or (status <> 'running' and completed_at is not null)
    ),
  constraint anonymous_guest_cleanup_runs_counts_valid
    check (
      eligible_count >= 0
      and marked_count >= 0
      and cancelled_count >= 0
      and claimed_count >= 0
      and completed_count >= 0
      and retry_count >= 0
      and blocked_count >= 0
    )
);

comment on table public.anonymous_guest_cleanup_runs is
  'Private, append-only operational audit rows for bounded anonymous-guest cleanup invocations, including non-mutating dry runs.';

create table public.anonymous_guest_cleanup_candidates (
  user_id uuid primary key,
  state text not null,
  first_marked_at timestamptz not null,
  delete_after timestamptz not null,
  eligibility_checked_at timestamptz not null,
  snapshot_at timestamptz,
  case_ids uuid[] not null default array[]::uuid[],
  storage_prefixes text[] not null default array[]::text[],
  storage_object_paths text[] not null default array[]::text[],
  lease_token uuid,
  lease_expires_at timestamptz,
  storage_deletion_started_at timestamptz,
  storage_deleted_at timestamptz,
  auth_deleted_at timestamptz,
  completed_at timestamptz,
  attempt_count integer not null default 0,
  retry_after timestamptz,
  last_error_code text,
  last_run_id uuid references public.anonymous_guest_cleanup_runs (id)
    on delete set null,
  constraint anonymous_guest_cleanup_candidates_state_valid
    check (
      state in (
        'grace',
        'executing',
        'storage_retry',
        'storage_deleted',
        'completed',
        'cancelled',
        'blocked'
      )
    ),
  constraint anonymous_guest_cleanup_candidates_grace_valid
    check (delete_after >= first_marked_at + interval '24 hours'),
  constraint anonymous_guest_cleanup_candidates_attempt_valid
    check (attempt_count >= 0),
  constraint anonymous_guest_cleanup_candidates_error_safe
    check (
      last_error_code is null
      or last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    ),
  constraint anonymous_guest_cleanup_candidates_lease_complete
    check (
      (lease_token is null and lease_expires_at is null)
      or (lease_token is not null and lease_expires_at is not null)
    ),
  constraint anonymous_guest_cleanup_candidates_snapshot_complete
    check (
      snapshot_at is not null
      or (
        cardinality(case_ids) = 0
        and cardinality(storage_prefixes) = 0
        and cardinality(storage_object_paths) = 0
      )
    ),
  constraint anonymous_guest_cleanup_candidates_storage_ordered
    check (
      storage_deleted_at is null
      or storage_deletion_started_at is not null
    ),
  constraint anonymous_guest_cleanup_candidates_completion_ordered
    check (
      completed_at is null
      or (
        state = 'completed'
        and storage_deleted_at is not null
        and auth_deleted_at is not null
      )
    )
);

comment on table public.anonymous_guest_cleanup_candidates is
  'Private durable queue and deletion fence. user_id deliberately has no Auth foreign key so the audit survives a hard Auth deletion.';
comment on column public.anonymous_guest_cleanup_candidates.storage_prefixes is
  'Immutable-at-execution snapshots of transfer-safe {report_storage_owner_id}/{case_id} prefixes for cases still owned by the candidate.';
comment on column public.anonymous_guest_cleanup_candidates.storage_object_paths is
  'Exact canonical and backup report paths permitted for Storage API deletion; the Edge Function blocks on every unexpected object.';

create index anonymous_guest_cleanup_candidates_due_idx
on public.anonymous_guest_cleanup_candidates (
  state,
  delete_after,
  retry_after,
  lease_expires_at
);

create table public.anonymous_guest_cleanup_events (
  id bigint generated always as identity primary key,
  run_id uuid references public.anonymous_guest_cleanup_runs (id)
    on delete set null,
  user_id uuid,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp(),
  constraint anonymous_guest_cleanup_events_type_safe
    check (event_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint anonymous_guest_cleanup_events_details_bounded
    check (
      jsonb_typeof(details) = 'object'
      and octet_length(details::text) <= 2048
    )
);

comment on table public.anonymous_guest_cleanup_events is
  'Private immutable cleanup journal containing bounded machine codes and counts only, never credentials or provider error text.';

create index anonymous_guest_cleanup_events_run_created_idx
on public.anonymous_guest_cleanup_events (run_id, created_at, id);

create table public.anonymous_guest_cleanup_scheduler_config (
  singleton boolean primary key default true,
  project_origin text not null,
  configured_at timestamptz not null default statement_timestamp(),
  constraint anonymous_guest_cleanup_scheduler_config_singleton
    check (singleton),
  constraint anonymous_guest_cleanup_scheduler_config_project_origin
    check (project_origin = 'https://bjvsgaqitehtwasugvla.supabase.co')
);

comment on table public.anonymous_guest_cleanup_scheduler_config is
  'Private non-secret destination fence, controlled separately from Vault, that pins cleanup dispatch to the linked Supabase project origin.';

insert into public.anonymous_guest_cleanup_scheduler_config (
  singleton,
  project_origin
)
values (
  true,
  'https://bjvsgaqitehtwasugvla.supabase.co'
);

alter table public.anonymous_guest_cleanup_runs enable row level security;
alter table public.anonymous_guest_cleanup_candidates enable row level security;
alter table public.anonymous_guest_cleanup_events enable row level security;
alter table public.anonymous_guest_cleanup_scheduler_config enable row level security;

revoke all on table public.anonymous_guest_cleanup_runs from public;
revoke all on table public.anonymous_guest_cleanup_runs from anon;
revoke all on table public.anonymous_guest_cleanup_runs from authenticated;
revoke all on table public.anonymous_guest_cleanup_runs from service_role;
revoke all on table public.anonymous_guest_cleanup_candidates from public;
revoke all on table public.anonymous_guest_cleanup_candidates from anon;
revoke all on table public.anonymous_guest_cleanup_candidates from authenticated;
revoke all on table public.anonymous_guest_cleanup_candidates from service_role;
revoke all on table public.anonymous_guest_cleanup_events from public;
revoke all on table public.anonymous_guest_cleanup_events from anon;
revoke all on table public.anonymous_guest_cleanup_events from authenticated;
revoke all on table public.anonymous_guest_cleanup_events from service_role;
revoke all on table public.anonymous_guest_cleanup_scheduler_config from public;
revoke all on table public.anonymous_guest_cleanup_scheduler_config from anon;
revoke all on table public.anonymous_guest_cleanup_scheduler_config from authenticated;
revoke all on table public.anonymous_guest_cleanup_scheduler_config from service_role;
revoke all on sequence public.anonymous_guest_cleanup_events_id_seq from public;
revoke all on sequence public.anonymous_guest_cleanup_events_id_seq from anon;
revoke all on sequence public.anonymous_guest_cleanup_events_id_seq from authenticated;
revoke all on sequence public.anonymous_guest_cleanup_events_id_seq from service_role;

create function public.is_abandoned_anonymous_guest_eligible(
  candidate_user_id uuid,
  observed_at timestamptz default statement_timestamp()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users as auth_user
    join public.profiles as profile
      on profile.id = auth_user.id
    where auth_user.id = candidate_user_id
      and auth_user.is_anonymous is true
      and auth_user.deleted_at is null
      and auth_user.created_at <= observed_at - interval '30 days'
      and coalesce(auth_user.updated_at, auth_user.created_at)
        <= observed_at - interval '30 days'
      and coalesce(auth_user.last_sign_in_at, auth_user.created_at)
        <= observed_at - interval '30 days'
      and profile.created_at <= observed_at - interval '30 days'
      and profile.updated_at <= observed_at - interval '30 days'
      and not exists (
        select 1
        from auth.identities as identity
        where identity.user_id = auth_user.id
          and identity.provider <> 'anonymous'
      )
      and not exists (
        select 1
        from public.staff_members as staff_member
        where staff_member.user_id = auth_user.id
      )
      and not exists (
        select 1
        from public.appraisal_cases as appraisal_case
        where appraisal_case.user_id = auth_user.id
          and (
            appraisal_case.service_type <> 'total_loss'
            or appraisal_case.status <> 'draft'
            or appraisal_case.created_at > observed_at - interval '30 days'
            or appraisal_case.updated_at > observed_at - interval '30 days'
            or appraisal_case.last_activity_at > observed_at - interval '30 days'
          )
      )
      and not exists (
        select 1
        from public.total_loss_case_details as details
        join public.appraisal_cases as appraisal_case
          on appraisal_case.id = details.case_id
        where appraisal_case.user_id = auth_user.id
          and (
            details.report_storage_owner_id <> auth_user.id
            or details.intake_completed_at is not null
            or details.report_extraction_status = 'pending'
            or (
              details.report_upload_id is not null
              and details.report_upload_expires_at > observed_at
            )
            or details.created_at > observed_at - interval '30 days'
            or details.updated_at > observed_at - interval '30 days'
          )
      )
      and not exists (
        select 1
        from public.total_loss_case_details as details
        join public.appraisal_cases as appraisal_case
          on appraisal_case.id = details.case_id
        where details.report_storage_owner_id = auth_user.id
          and appraisal_case.user_id <> auth_user.id
      )
      and not exists (
        select 1
        from storage.objects as storage_object
        where storage_object.bucket_id = 'case-files'
          and storage_object.name like auth_user.id::text || '/%'
          and (
            storage_object.created_at > observed_at - interval '30 days'
            or storage_object.updated_at > observed_at - interval '30 days'
          )
      )
      and not exists (
        select 1
        from public.total_loss_case_contacts as contact
        join public.appraisal_cases as appraisal_case
          on appraisal_case.id = contact.case_id
        where appraisal_case.user_id = auth_user.id
          and (
            contact.email_verified_at is not null
            or contact.created_at > observed_at - interval '30 days'
            or contact.updated_at > observed_at - interval '30 days'
          )
      )
      and not exists (
        select 1
        from public.total_loss_case_identity_claims as identity_claim
        join public.appraisal_cases as appraisal_case
          on appraisal_case.id = identity_claim.case_id
        where (
          identity_claim.source_user_id = auth_user.id
          or appraisal_case.user_id = auth_user.id
        )
          and (
            identity_claim.claimed_at is not null
            or (
              identity_claim.claimed_at is null
              and identity_claim.revoked_at is null
              and identity_claim.expires_at > observed_at
            )
          )
      )
      and not exists (
        select 1
        from public.total_loss_analysis_jobs as analysis_job
        join public.appraisal_cases as appraisal_case
          on appraisal_case.id = analysis_job.case_id
        where appraisal_case.user_id = auth_user.id
      )
      and not exists (
        select 1
        from public.analysis_runs as analysis_run
        join public.appraisal_cases as appraisal_case
          on appraisal_case.id = analysis_run.case_id
        where appraisal_case.user_id = auth_user.id
      )
  );
$$;

comment on function public.is_abandoned_anonymous_guest_eligible(uuid, timestamptz) is
  'Conservative server-side 30-day predicate. It excludes permanent identities, staff, claims, every non-draft or recently active case, every analysis attempt, and every transfer or storage-owner mismatch.';

revoke execute on function public.is_abandoned_anonymous_guest_eligible(uuid, timestamptz) from public;
revoke execute on function public.is_abandoned_anonymous_guest_eligible(uuid, timestamptz) from anon;
revoke execute on function public.is_abandoned_anonymous_guest_eligible(uuid, timestamptz) from authenticated;
revoke execute on function public.is_abandoned_anonymous_guest_eligible(uuid, timestamptz) from service_role;

create function public.anonymous_guest_cleanup_user_frozen(candidate_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.anonymous_guest_cleanup_candidates as candidate
    where candidate.user_id = candidate_user_id
      and (
        candidate.state in ('executing', 'storage_retry', 'storage_deleted')
        or (
          candidate.state = 'blocked'
          and candidate.storage_deletion_started_at is not null
        )
      )
  );
$$;

revoke execute on function public.anonymous_guest_cleanup_user_frozen(uuid) from public;
revoke execute on function public.anonymous_guest_cleanup_user_frozen(uuid) from anon;
revoke execute on function public.anonymous_guest_cleanup_user_frozen(uuid) from authenticated;
revoke execute on function public.anonymous_guest_cleanup_user_frozen(uuid) from service_role;

create function public.assert_anonymous_guest_cleanup_user_mutable(candidate_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if candidate_user_id is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'venfour-anonymous-cleanup:' || candidate_user_id::text,
      0
    )
  );

  if public.anonymous_guest_cleanup_user_frozen(candidate_user_id) then
    raise exception using
      errcode = '55000',
      message = 'This anonymous guest is being retired. Mutations are temporarily disabled.';
  end if;
end;
$$;

revoke execute on function public.assert_anonymous_guest_cleanup_user_mutable(uuid) from public;
revoke execute on function public.assert_anonymous_guest_cleanup_user_mutable(uuid) from anon;
revoke execute on function public.assert_anonymous_guest_cleanup_user_mutable(uuid) from authenticated;
revoke execute on function public.assert_anonymous_guest_cleanup_user_mutable(uuid) from service_role;

create function public.is_current_auth_user_cleanup_frozen()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
begin
  if authenticated_user_id is null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'venfour-anonymous-cleanup:' || authenticated_user_id::text,
      0
    )
  );

  return public.anonymous_guest_cleanup_user_frozen(authenticated_user_id);
end;
$$;

revoke execute on function public.is_current_auth_user_cleanup_frozen() from public;
revoke execute on function public.is_current_auth_user_cleanup_frozen() from anon;
grant execute on function public.is_current_auth_user_cleanup_frozen() to authenticated;
revoke execute on function public.is_current_auth_user_cleanup_frozen() from service_role;

create function public.guard_anonymous_guest_cleanup_mutation()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate_user_id uuid;
  previous_user_id uuid;
  candidate_case_id uuid;
  previous_case_id uuid;
  source_user_id uuid;
  previous_source_user_id uuid;
begin
  if tg_table_schema = 'public' and tg_table_name = 'profiles' then
    candidate_user_id := new.id;
    if tg_op = 'UPDATE' then
      previous_user_id := old.id;
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'appraisal_cases' then
    candidate_user_id := new.user_id;
    if tg_op = 'UPDATE' then
      previous_user_id := old.user_id;
    end if;
  elsif tg_table_schema = 'public' and tg_table_name = 'staff_members' then
    candidate_user_id := new.user_id;
    if tg_op = 'UPDATE' then
      previous_user_id := old.user_id;
    end if;
  elsif tg_table_schema = 'auth' and tg_table_name = 'users' then
    candidate_user_id := new.id;
    if tg_op = 'UPDATE' then
      previous_user_id := old.id;
    end if;
  else
    candidate_case_id := new.case_id;
    if tg_op = 'UPDATE' then
      previous_case_id := old.case_id;
    end if;

    select appraisal_case.user_id
    into candidate_user_id
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = candidate_case_id;

    if previous_case_id is distinct from candidate_case_id then
      select appraisal_case.user_id
      into previous_user_id
      from public.appraisal_cases as appraisal_case
      where appraisal_case.id = previous_case_id;
    else
      previous_user_id := candidate_user_id;
    end if;

    if tg_table_name = 'total_loss_case_identity_claims' then
      source_user_id := new.source_user_id;
      if tg_op = 'UPDATE' then
        previous_source_user_id := old.source_user_id;
      end if;
    end if;
  end if;

  perform public.assert_anonymous_guest_cleanup_user_mutable(candidate_user_id);

  if previous_user_id is distinct from candidate_user_id then
    perform public.assert_anonymous_guest_cleanup_user_mutable(previous_user_id);
  end if;

  if source_user_id is distinct from candidate_user_id then
    perform public.assert_anonymous_guest_cleanup_user_mutable(source_user_id);
  end if;

  if previous_source_user_id is distinct from source_user_id
    and previous_source_user_id is distinct from candidate_user_id
  then
    perform public.assert_anonymous_guest_cleanup_user_mutable(previous_source_user_id);
  end if;

  return new;
end;
$$;

comment on function public.guard_anonymous_guest_cleanup_mutation() is
  'Trigger-only deletion fence sharing an advisory lock with candidate claims so customer, Auth-conversion, staff, and trusted-worker writes cannot race Storage/Auth deletion.';

revoke execute on function public.guard_anonymous_guest_cleanup_mutation() from public;
revoke execute on function public.guard_anonymous_guest_cleanup_mutation() from anon;
revoke execute on function public.guard_anonymous_guest_cleanup_mutation() from authenticated;
revoke execute on function public.guard_anonymous_guest_cleanup_mutation() from service_role;

create trigger profiles_guard_anonymous_guest_cleanup
before insert or update on public.profiles
for each row execute function public.guard_anonymous_guest_cleanup_mutation();

create trigger appraisal_cases_guard_anonymous_guest_cleanup
before insert or update on public.appraisal_cases
for each row execute function public.guard_anonymous_guest_cleanup_mutation();

create trigger staff_members_guard_anonymous_guest_cleanup
before insert or update on public.staff_members
for each row execute function public.guard_anonymous_guest_cleanup_mutation();

create trigger auth_users_guard_anonymous_guest_cleanup
before update on auth.users
for each row execute function public.guard_anonymous_guest_cleanup_mutation();

create trigger total_loss_case_details_guard_anonymous_guest_cleanup
before insert or update on public.total_loss_case_details
for each row execute function public.guard_anonymous_guest_cleanup_mutation();

create trigger total_loss_case_contacts_guard_anonymous_guest_cleanup
before insert or update on public.total_loss_case_contacts
for each row execute function public.guard_anonymous_guest_cleanup_mutation();

create trigger total_loss_case_identity_claims_guard_anonymous_guest_cleanup
before insert or update on public.total_loss_case_identity_claims
for each row execute function public.guard_anonymous_guest_cleanup_mutation();

create trigger total_loss_report_extractions_guard_anonymous_guest_cleanup
before insert or update on public.total_loss_report_extractions
for each row execute function public.guard_anonymous_guest_cleanup_mutation();

create trigger total_loss_analysis_jobs_guard_anonymous_guest_cleanup
before insert or update on public.total_loss_analysis_jobs
for each row execute function public.guard_anonymous_guest_cleanup_mutation();

create trigger analysis_runs_guard_anonymous_guest_cleanup
before insert or update on public.analysis_runs
for each row execute function public.guard_anonymous_guest_cleanup_mutation();

create policy "Cleanup-frozen customers cannot add case files"
on storage.objects
as restrictive
for insert
to authenticated
with check (not public.is_current_auth_user_cleanup_frozen());

create policy "Cleanup-frozen customers cannot update case files"
on storage.objects
as restrictive
for update
to authenticated
using (not public.is_current_auth_user_cleanup_frozen())
with check (not public.is_current_auth_user_cleanup_frozen());

create policy "Cleanup-frozen customers cannot delete case files"
on storage.objects
as restrictive
for delete
to authenticated
using (not public.is_current_auth_user_cleanup_frozen());

create function public.begin_abandoned_anonymous_guest_cleanup_run(
  requested_dry_run boolean default false,
  batch_size integer default 25
)
returns table (
  run_id uuid,
  dry_run boolean,
  run_status text,
  eligible_count integer,
  marked_count integer,
  cancelled_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_observed_at timestamptz := statement_timestamp();
  v_batch_size integer := greatest(1, least(coalesce(batch_size, 25), 100));
  v_eligible_count integer := 0;
  v_marked_count integer := 0;
  v_cancelled_count integer := 0;
  v_status text := 'running';
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('venfour-anonymous-cleanup-run', 0)
  );

  update public.anonymous_guest_cleanup_runs as cleanup_run
  set
    status = 'failed',
    completed_at = v_observed_at
  where cleanup_run.status = 'running'
    and cleanup_run.started_at <= v_observed_at - interval '30 minutes';

  if exists (
    select 1
    from public.anonymous_guest_cleanup_runs as cleanup_run
    where cleanup_run.status = 'running'
  ) then
    v_status := 'skipped';
  end if;

  insert into public.anonymous_guest_cleanup_runs (
    dry_run,
    requested_batch_size,
    status,
    completed_at
  )
  values (
    coalesce(requested_dry_run, false),
    v_batch_size,
    v_status,
    case when v_status = 'skipped' then v_observed_at end
  )
  returning id into v_run_id;

  if v_status = 'skipped' then
    insert into public.anonymous_guest_cleanup_events (
      run_id,
      event_type,
      details
    )
    values (
      v_run_id,
      'run_skipped',
      jsonb_build_object('reason', 'RUN_ALREADY_ACTIVE')
    );

    return query
    select v_run_id, coalesce(requested_dry_run, false), v_status, 0, 0, 0;
    return;
  end if;

  select count(*)::integer
  into v_eligible_count
  from auth.users as auth_user
  where public.is_abandoned_anonymous_guest_eligible(
    auth_user.id,
    v_observed_at
  );

  if coalesce(requested_dry_run, false) then
    update public.anonymous_guest_cleanup_runs as cleanup_run
    set
      status = 'completed',
      eligible_count = v_eligible_count,
      completed_at = v_observed_at
    where cleanup_run.id = v_run_id;

    insert into public.anonymous_guest_cleanup_events (
      run_id,
      event_type,
      details
    )
    values (
      v_run_id,
      'dry_run_completed',
      jsonb_build_object('eligibleCount', v_eligible_count)
    );

    return query
    select v_run_id, true, 'completed'::text, v_eligible_count, 0, 0;
    return;
  end if;

  with cancelled as (
    update public.anonymous_guest_cleanup_candidates as candidate
    set
      state = 'cancelled',
      eligibility_checked_at = v_observed_at,
      lease_token = null,
      lease_expires_at = null,
      retry_after = null,
      last_error_code = 'NO_LONGER_ELIGIBLE',
      last_run_id = v_run_id
    where candidate.state = 'grace'
      and not public.is_abandoned_anonymous_guest_eligible(
        candidate.user_id,
        v_observed_at
      )
    returning candidate.user_id
  )
  insert into public.anonymous_guest_cleanup_events (
    run_id,
    user_id,
    event_type,
    details
  )
  select
    v_run_id,
    cancelled.user_id,
    'candidate_cancelled',
    jsonb_build_object('reason', 'NO_LONGER_ELIGIBLE')
  from cancelled;

  get diagnostics v_cancelled_count = row_count;

  with eligible_users as (
    select auth_user.id
    from auth.users as auth_user
    where public.is_abandoned_anonymous_guest_eligible(
      auth_user.id,
      v_observed_at
    )
      and not exists (
        select 1
        from public.anonymous_guest_cleanup_candidates as existing_candidate
        where existing_candidate.user_id = auth_user.id
          and existing_candidate.state <> 'cancelled'
      )
    order by
      coalesce(auth_user.last_sign_in_at, auth_user.created_at),
      auth_user.created_at,
      auth_user.id
    limit v_batch_size
  ),
  marked as (
    insert into public.anonymous_guest_cleanup_candidates as candidate (
      user_id,
      state,
      first_marked_at,
      delete_after,
      eligibility_checked_at,
      last_run_id
    )
    select
      eligible_user.id,
      'grace',
      v_observed_at,
      v_observed_at + interval '24 hours',
      v_observed_at,
      v_run_id
    from eligible_users as eligible_user
    on conflict (user_id) do update
    set
      state = 'grace',
      first_marked_at = excluded.first_marked_at,
      delete_after = excluded.delete_after,
      eligibility_checked_at = excluded.eligibility_checked_at,
      snapshot_at = null,
      case_ids = array[]::uuid[],
      storage_prefixes = array[]::text[],
      storage_object_paths = array[]::text[],
      lease_token = null,
      lease_expires_at = null,
      storage_deletion_started_at = null,
      storage_deleted_at = null,
      auth_deleted_at = null,
      completed_at = null,
      attempt_count = 0,
      retry_after = null,
      last_error_code = null,
      last_run_id = excluded.last_run_id
    where candidate.state = 'cancelled'
    returning candidate.user_id
  )
  insert into public.anonymous_guest_cleanup_events (
    run_id,
    user_id,
    event_type,
    details
  )
  select
    v_run_id,
    marked.user_id,
    'candidate_marked',
    jsonb_build_object('graceHours', 24)
  from marked;

  get diagnostics v_marked_count = row_count;

  update public.anonymous_guest_cleanup_runs as cleanup_run
  set
    eligible_count = v_eligible_count,
    marked_count = v_marked_count,
    cancelled_count = v_cancelled_count
  where cleanup_run.id = v_run_id;

  return query
  select
    v_run_id,
    false,
    'running'::text,
    v_eligible_count,
    v_marked_count,
    v_cancelled_count;
end;
$$;

comment on function public.begin_abandoned_anonymous_guest_cleanup_run(boolean, integer) is
  'Starts one bounded cleanup invocation. Dry runs write audit counts only; real runs mark at most 100 new candidates and enforce a fresh 24-hour grace period.';

revoke execute on function public.begin_abandoned_anonymous_guest_cleanup_run(boolean, integer) from public;
revoke execute on function public.begin_abandoned_anonymous_guest_cleanup_run(boolean, integer) from anon;
revoke execute on function public.begin_abandoned_anonymous_guest_cleanup_run(boolean, integer) from authenticated;
grant execute on function public.begin_abandoned_anonymous_guest_cleanup_run(boolean, integer) to service_role;

create function public.claim_abandoned_anonymous_guest_cleanup_candidate(
  cleanup_run_id uuid,
  requested_lease_token uuid
)
returns table (
  user_id uuid,
  cleanup_action text,
  case_ids uuid[],
  storage_prefixes text[],
  storage_object_paths text[]
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate public.anonymous_guest_cleanup_candidates%rowtype;
  v_now timestamptz := statement_timestamp();
  v_case_ids uuid[];
  v_storage_prefixes text[];
  v_storage_object_paths text[];
  v_action text;
begin
  if requested_lease_token is null then
    raise exception using
      errcode = '22004',
      message = 'A cleanup lease token is required.';
  end if;

  if not exists (
    select 1
    from public.anonymous_guest_cleanup_runs as cleanup_run
    where cleanup_run.id = cleanup_run_id
      and cleanup_run.status = 'running'
      and not cleanup_run.dry_run
  ) then
    raise exception using
      errcode = '55000',
      message = 'The cleanup run is not active.';
  end if;

  loop
    select cleanup_candidate.*
    into candidate
    from public.anonymous_guest_cleanup_candidates as cleanup_candidate
    where (
      cleanup_candidate.state = 'grace'
      and cleanup_candidate.delete_after <= v_now
    ) or (
      cleanup_candidate.state = 'executing'
      and cleanup_candidate.lease_expires_at <= v_now
    ) or (
      cleanup_candidate.state = 'storage_retry'
      and coalesce(cleanup_candidate.retry_after, v_now) <= v_now
    ) or (
      cleanup_candidate.state = 'storage_deleted'
      and coalesce(cleanup_candidate.retry_after, v_now) <= v_now
    )
    order by
      case cleanup_candidate.state
        when 'storage_deleted' then 0
        when 'storage_retry' then 1
        when 'executing' then 2
        else 3
      end,
      cleanup_candidate.delete_after,
      cleanup_candidate.user_id
    for update skip locked
    limit 1;

    if not found then
      return;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'venfour-anonymous-cleanup:' || candidate.user_id::text,
        0
      )
    );

    if candidate.state in ('grace', 'executing')
      and candidate.storage_deletion_started_at is null
      and not public.is_abandoned_anonymous_guest_eligible(
        candidate.user_id,
        v_now
      )
    then
      update public.anonymous_guest_cleanup_candidates as cleanup_candidate
      set
        state = 'cancelled',
        eligibility_checked_at = v_now,
        lease_token = null,
        lease_expires_at = null,
        retry_after = null,
        last_error_code = 'NO_LONGER_ELIGIBLE',
        last_run_id = cleanup_run_id
      where cleanup_candidate.user_id = candidate.user_id;

      insert into public.anonymous_guest_cleanup_events (
        run_id,
        user_id,
        event_type,
        details
      )
      values (
        cleanup_run_id,
        candidate.user_id,
        'candidate_cancelled',
        jsonb_build_object('reason', 'NO_LONGER_ELIGIBLE')
      );

      continue;
    end if;

    if candidate.snapshot_at is null then
      select coalesce(
        array_agg(appraisal_case.id order by appraisal_case.id),
        array[]::uuid[]
      )
      into v_case_ids
      from public.appraisal_cases as appraisal_case
      where appraisal_case.user_id = candidate.user_id;

      select coalesce(
        array_agg(
          details.report_storage_owner_id::text || '/' || details.case_id::text
          order by details.case_id
        ),
        array[]::text[]
      )
      into v_storage_prefixes
      from public.total_loss_case_details as details
      join public.appraisal_cases as appraisal_case
        on appraisal_case.id = details.case_id
      where appraisal_case.user_id = candidate.user_id
        and details.report_storage_owner_id = candidate.user_id;

      select coalesce(
        array_agg(
          storage_prefix || '/' || object_basename
          order by storage_prefix, object_basename
        ),
        array[]::text[]
      )
      into v_storage_object_paths
      from unnest(v_storage_prefixes) as storage_prefix
      cross join unnest(
        array['valuation-report-backup.pdf', 'valuation-report.pdf']::text[]
      ) as object_basename;

      update public.anonymous_guest_cleanup_candidates as cleanup_candidate
      set
        snapshot_at = v_now,
        case_ids = v_case_ids,
        storage_prefixes = v_storage_prefixes,
        storage_object_paths = v_storage_object_paths
      where cleanup_candidate.user_id = candidate.user_id;
    else
      v_case_ids := candidate.case_ids;
      v_storage_prefixes := candidate.storage_prefixes;
      v_storage_object_paths := candidate.storage_object_paths;
    end if;

    if candidate.state = 'storage_deleted' then
      v_action := 'delete_auth';
    else
      v_action := 'delete_storage';
    end if;

    update public.anonymous_guest_cleanup_candidates as cleanup_candidate
    set
      state = case
        when candidate.state = 'storage_deleted' then 'storage_deleted'
        else 'executing'
      end,
      eligibility_checked_at = v_now,
      lease_token = requested_lease_token,
      lease_expires_at = v_now + interval '10 minutes',
      attempt_count = cleanup_candidate.attempt_count + 1,
      retry_after = null,
      last_error_code = null,
      last_run_id = cleanup_run_id
    where cleanup_candidate.user_id = candidate.user_id;

    insert into public.anonymous_guest_cleanup_events (
      run_id,
      user_id,
      event_type,
      details
    )
    values (
      cleanup_run_id,
      candidate.user_id,
      'candidate_claimed',
      jsonb_build_object(
        'action', v_action,
        'caseCount', cardinality(v_case_ids),
        'storageObjectCount', cardinality(v_storage_object_paths)
      )
    );

    return query
    select
      candidate.user_id,
      v_action,
      v_case_ids,
      v_storage_prefixes,
      v_storage_object_paths;
    return;
  end loop;
end;
$$;

comment on function public.claim_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid) is
  'Revalidates and advisory-locks one due candidate, snapshots only exact immutable report namespaces still owned by that user, and grants a short idempotent execution lease.';

revoke execute on function public.claim_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid) from public;
revoke execute on function public.claim_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid) from anon;
revoke execute on function public.claim_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid) from authenticated;
grant execute on function public.claim_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid) to service_role;

create function public.start_abandoned_anonymous_guest_storage_deletion(
  candidate_user_id uuid,
  candidate_lease_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  update public.anonymous_guest_cleanup_candidates as candidate
  set
    state = 'executing',
    storage_deletion_started_at = coalesce(
      candidate.storage_deletion_started_at,
      statement_timestamp()
    )
  where candidate.user_id = candidate_user_id
    and candidate.state in ('executing', 'storage_retry')
    and candidate.lease_token = candidate_lease_token;

  get diagnostics affected_rows = row_count;

  if affected_rows <> 1 then
    raise exception using
      errcode = '55000',
      message = 'The cleanup storage lease is no longer valid.';
  end if;

  return true;
end;
$$;

revoke execute on function public.start_abandoned_anonymous_guest_storage_deletion(uuid, uuid) from public;
revoke execute on function public.start_abandoned_anonymous_guest_storage_deletion(uuid, uuid) from anon;
revoke execute on function public.start_abandoned_anonymous_guest_storage_deletion(uuid, uuid) from authenticated;
grant execute on function public.start_abandoned_anonymous_guest_storage_deletion(uuid, uuid) to service_role;

create function public.mark_abandoned_anonymous_guest_storage_deleted(
  candidate_user_id uuid,
  candidate_lease_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  update public.anonymous_guest_cleanup_candidates as candidate
  set
    state = 'storage_deleted',
    storage_deleted_at = coalesce(
      candidate.storage_deleted_at,
      statement_timestamp()
    ),
    retry_after = null,
    last_error_code = null
  where candidate.user_id = candidate_user_id
    and candidate.state in ('executing', 'storage_retry', 'storage_deleted')
    and candidate.lease_token = candidate_lease_token
    and candidate.storage_deletion_started_at is not null
    and not exists (
      select 1
      from storage.objects as storage_object
      where storage_object.bucket_id = 'case-files'
        and (
          storage_object.name = candidate.user_id::text
          or storage_object.name like candidate.user_id::text || '/%'
        )
    );

  get diagnostics affected_rows = row_count;

  if affected_rows <> 1 then
    raise exception using
      errcode = '55000',
      message = 'The cleanup storage completion lease is no longer valid.';
  end if;

  return true;
end;
$$;

revoke execute on function public.mark_abandoned_anonymous_guest_storage_deleted(uuid, uuid) from public;
revoke execute on function public.mark_abandoned_anonymous_guest_storage_deleted(uuid, uuid) from anon;
revoke execute on function public.mark_abandoned_anonymous_guest_storage_deleted(uuid, uuid) from authenticated;
grant execute on function public.mark_abandoned_anonymous_guest_storage_deleted(uuid, uuid) to service_role;

create function public.retry_abandoned_anonymous_guest_cleanup_candidate(
  candidate_user_id uuid,
  candidate_lease_token uuid,
  error_code text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate public.anonymous_guest_cleanup_candidates%rowtype;
begin
  if error_code is null
    or error_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
  then
    raise exception using
      errcode = '22023',
      message = 'A bounded cleanup error code is required.';
  end if;

  select cleanup_candidate.*
  into candidate
  from public.anonymous_guest_cleanup_candidates as cleanup_candidate
  where cleanup_candidate.user_id = candidate_user_id
    and cleanup_candidate.lease_token = candidate_lease_token
    and cleanup_candidate.state in (
      'executing',
      'storage_retry',
      'storage_deleted'
    )
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'The cleanup retry lease is no longer valid.';
  end if;

  update public.anonymous_guest_cleanup_candidates as cleanup_candidate
  set
    state = case
      when candidate.storage_deleted_at is not null then 'storage_deleted'
      else 'storage_retry'
    end,
    retry_after = statement_timestamp() + interval '1 hour',
    lease_token = null,
    lease_expires_at = null,
    last_error_code = error_code
  where cleanup_candidate.user_id = candidate_user_id;

  insert into public.anonymous_guest_cleanup_events (
    run_id,
    user_id,
    event_type,
    details
  )
  values (
    candidate.last_run_id,
    candidate_user_id,
    'candidate_retry',
    jsonb_build_object('errorCode', error_code)
  );

  return true;
end;
$$;

revoke execute on function public.retry_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid, text) from public;
revoke execute on function public.retry_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid, text) from anon;
revoke execute on function public.retry_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid, text) from authenticated;
grant execute on function public.retry_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid, text) to service_role;

create function public.block_abandoned_anonymous_guest_cleanup_candidate(
  candidate_user_id uuid,
  candidate_lease_token uuid,
  error_code text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate public.anonymous_guest_cleanup_candidates%rowtype;
begin
  if error_code is null
    or error_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
  then
    raise exception using
      errcode = '22023',
      message = 'A bounded cleanup error code is required.';
  end if;

  select cleanup_candidate.*
  into candidate
  from public.anonymous_guest_cleanup_candidates as cleanup_candidate
  where cleanup_candidate.user_id = candidate_user_id
    and cleanup_candidate.lease_token = candidate_lease_token
    and cleanup_candidate.state in (
      'executing',
      'storage_retry',
      'storage_deleted'
    )
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'The cleanup block lease is no longer valid.';
  end if;

  update public.anonymous_guest_cleanup_candidates as cleanup_candidate
  set
    state = 'blocked',
    retry_after = null,
    lease_token = null,
    lease_expires_at = null,
    last_error_code = error_code
  where cleanup_candidate.user_id = candidate_user_id;

  insert into public.anonymous_guest_cleanup_events (
    run_id,
    user_id,
    event_type,
    details
  )
  values (
    candidate.last_run_id,
    candidate_user_id,
    'candidate_blocked',
    jsonb_build_object('errorCode', error_code)
  );

  return true;
end;
$$;

revoke execute on function public.block_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid, text) from public;
revoke execute on function public.block_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid, text) from anon;
revoke execute on function public.block_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid, text) from authenticated;
grant execute on function public.block_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid, text) to service_role;

create function public.complete_abandoned_anonymous_guest_cleanup_candidate(
  candidate_user_id uuid,
  candidate_lease_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate public.anonymous_guest_cleanup_candidates%rowtype;
begin
  select cleanup_candidate.*
  into candidate
  from public.anonymous_guest_cleanup_candidates as cleanup_candidate
  where cleanup_candidate.user_id = candidate_user_id
    and cleanup_candidate.lease_token = candidate_lease_token
    and cleanup_candidate.state = 'storage_deleted'
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'The cleanup completion lease is no longer valid.';
  end if;

  if exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = candidate_user_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'Auth deletion has not completed.';
  end if;

  if exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.user_id = candidate_user_id
  ) then
    raise exception using
      errcode = '55000',
      message = 'Owned cases remain after Auth deletion.';
  end if;

  update public.anonymous_guest_cleanup_candidates as cleanup_candidate
  set
    state = 'completed',
    auth_deleted_at = coalesce(
      cleanup_candidate.auth_deleted_at,
      statement_timestamp()
    ),
    completed_at = coalesce(
      cleanup_candidate.completed_at,
      statement_timestamp()
    ),
    lease_token = null,
    lease_expires_at = null,
    retry_after = null,
    last_error_code = null
  where cleanup_candidate.user_id = candidate_user_id;

  insert into public.anonymous_guest_cleanup_events (
    run_id,
    user_id,
    event_type,
    details
  )
  values (
    candidate.last_run_id,
    candidate_user_id,
    'candidate_completed',
    jsonb_build_object(
      'caseCount', cardinality(candidate.case_ids),
      'storageObjectCount', cardinality(candidate.storage_object_paths)
    )
  );

  return true;
end;
$$;

revoke execute on function public.complete_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid) from public;
revoke execute on function public.complete_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid) from anon;
revoke execute on function public.complete_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid) from authenticated;
grant execute on function public.complete_abandoned_anonymous_guest_cleanup_candidate(uuid, uuid) to service_role;

create function public.finish_abandoned_anonymous_guest_cleanup_run(
  cleanup_run_id uuid,
  failed boolean default false
)
returns table (
  run_id uuid,
  run_status text,
  eligible_count integer,
  marked_count integer,
  cancelled_count integer,
  claimed_count integer,
  completed_count integer,
  retry_count integer,
  blocked_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.anonymous_guest_cleanup_runs as cleanup_run
  set
    status = case when coalesce(failed, false) then 'failed' else 'completed' end,
    completed_at = statement_timestamp(),
    cancelled_count = (
      select count(*)::integer
      from public.anonymous_guest_cleanup_events as cleanup_event
      where cleanup_event.run_id = cleanup_run_id
        and cleanup_event.event_type = 'candidate_cancelled'
    ),
    claimed_count = (
      select count(*)::integer
      from public.anonymous_guest_cleanup_events as cleanup_event
      where cleanup_event.run_id = cleanup_run_id
        and cleanup_event.event_type = 'candidate_claimed'
    ),
    completed_count = (
      select count(*)::integer
      from public.anonymous_guest_cleanup_events as cleanup_event
      where cleanup_event.run_id = cleanup_run_id
        and cleanup_event.event_type = 'candidate_completed'
    ),
    retry_count = (
      select count(*)::integer
      from public.anonymous_guest_cleanup_events as cleanup_event
      where cleanup_event.run_id = cleanup_run_id
        and cleanup_event.event_type = 'candidate_retry'
    ),
    blocked_count = (
      select count(*)::integer
      from public.anonymous_guest_cleanup_events as cleanup_event
      where cleanup_event.run_id = cleanup_run_id
        and cleanup_event.event_type = 'candidate_blocked'
    )
  where cleanup_run.id = cleanup_run_id
    and cleanup_run.status = 'running';

  if not found then
    raise exception using
      errcode = '55000',
      message = 'The cleanup run cannot be finished.';
  end if;

  insert into public.anonymous_guest_cleanup_events (
    run_id,
    event_type,
    details
  )
  values (
    cleanup_run_id,
    case when coalesce(failed, false) then 'run_failed' else 'run_completed' end,
    '{}'::jsonb
  );

  return query
  select
    cleanup_run.id,
    cleanup_run.status,
    cleanup_run.eligible_count,
    cleanup_run.marked_count,
    cleanup_run.cancelled_count,
    cleanup_run.claimed_count,
    cleanup_run.completed_count,
    cleanup_run.retry_count,
    cleanup_run.blocked_count
  from public.anonymous_guest_cleanup_runs as cleanup_run
  where cleanup_run.id = cleanup_run_id;
end;
$$;

comment on function public.finish_abandoned_anonymous_guest_cleanup_run(uuid, boolean) is
  'Closes an Edge invocation and derives its terminal counters from the immutable cleanup event journal.';

revoke execute on function public.finish_abandoned_anonymous_guest_cleanup_run(uuid, boolean) from public;
revoke execute on function public.finish_abandoned_anonymous_guest_cleanup_run(uuid, boolean) from anon;
revoke execute on function public.finish_abandoned_anonymous_guest_cleanup_run(uuid, boolean) from authenticated;
grant execute on function public.finish_abandoned_anonymous_guest_cleanup_run(uuid, boolean) to service_role;

create function public.invoke_abandoned_anonymous_guest_cleanup()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  edge_function_url text;
  project_origin text;
  expected_edge_function_url text;
  schedule_secret text;
  request_id bigint;
begin
  select decrypted_secret
  into edge_function_url
  from vault.decrypted_secrets
  where name = 'venfour_cleanup_edge_function_url'
  order by created_at desc
  limit 1;

  select scheduler_config.project_origin
  into project_origin
  from public.anonymous_guest_cleanup_scheduler_config as scheduler_config
  where scheduler_config.singleton;

  if project_origin is distinct from
    'https://bjvsgaqitehtwasugvla.supabase.co'
  then
    raise exception using
      errcode = '55000',
      message = 'The anonymous cleanup Supabase project origin is not configured safely.';
  end if;

  expected_edge_function_url := project_origin
    || '/functions/v1/cleanup-abandoned-anonymous-guests';

  select decrypted_secret
  into schedule_secret
  from vault.decrypted_secrets
  where name = 'venfour_cleanup_schedule_secret'
  order by created_at desc
  limit 1;

  if edge_function_url is distinct from expected_edge_function_url
  then
    raise exception using
      errcode = '55000',
      message = 'The anonymous cleanup Edge Function URL does not match the configured Supabase project.';
  end if;

  if schedule_secret is null
    or octet_length(schedule_secret) < 32
    or octet_length(schedule_secret) > 512
  then
    raise exception using
      errcode = '55000',
      message = 'The anonymous cleanup schedule secret is not configured safely.';
  end if;

  select net.http_post(
    url := edge_function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Venfour-Cleanup-Secret', schedule_secret
    ),
    body := jsonb_build_object(
      'dryRun', false,
      'batchSize', 25
    ),
    timeout_milliseconds := 120000
  )
  into request_id;

  return request_id;
end;
$$;

comment on function public.invoke_abandoned_anonymous_guest_cleanup() is
  'Cron-only pg_net dispatcher. It accepts the Vault Edge URL only when it exactly matches the separately controlled linked-project origin and fixed function path.';

revoke execute on function public.invoke_abandoned_anonymous_guest_cleanup() from public;
revoke execute on function public.invoke_abandoned_anonymous_guest_cleanup() from anon;
revoke execute on function public.invoke_abandoned_anonymous_guest_cleanup() from authenticated;
revoke execute on function public.invoke_abandoned_anonymous_guest_cleanup() from service_role;

select cron.schedule(
  'venfour-abandoned-anonymous-guest-cleanup-daily',
  '17 3 * * *',
  'select public.invoke_abandoned_anonymous_guest_cleanup();'
);
