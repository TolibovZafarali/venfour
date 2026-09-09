-- Preserve submitted referral history before any out-of-transaction file deletion.
-- Existing attribution immutability and cleanup lease contracts remain authoritative.
create function public.anonymous_guest_has_protected_referral(candidate_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.referral_case_attributions as attribution
    join public.appraisal_cases as appraisal_case on appraisal_case.id = attribution.case_id
    where attribution.submitted_at is not null
      and (
        appraisal_case.user_id = candidate_user_id
        or exists (
          select 1 from public.total_loss_case_details as details
          where details.case_id = attribution.case_id
            and details.report_storage_owner_id = candidate_user_id
        )
        or exists (
          select 1 from public.total_loss_case_identity_claims as claim
          where claim.case_id = attribution.case_id and claim.source_user_id = candidate_user_id
        )
        or exists (
          select 1 from public.anonymous_guest_cleanup_candidates as candidate
          where candidate.user_id = candidate_user_id
            and attribution.case_id = any(candidate.case_ids)
        )
      )
  );
$$;
revoke all on function public.anonymous_guest_has_protected_referral(uuid)
  from public, anon, authenticated, service_role;

-- Serialize referral creation/submission with the existing deletion fence for
-- owners, retained report owners, claim sources and previously snapshotted users.
create function public.guard_referral_attribution_guest_cleanup()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  related_user_id uuid;
begin
  for related_user_id in
    select distinct related.user_id
    from (
      select c.user_id from public.appraisal_cases c where c.id = new.case_id
      union
      select d.report_storage_owner_id from public.total_loss_case_details d where d.case_id = new.case_id
      union
      select c.source_user_id from public.total_loss_case_identity_claims c where c.case_id = new.case_id
      union
      select c.user_id from public.anonymous_guest_cleanup_candidates c where new.case_id = any(c.case_ids)
    ) as related
    where related.user_id is not null
    order by related.user_id
  loop
    perform public.assert_anonymous_guest_cleanup_user_mutable(related_user_id);
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_referral_attribution_guest_cleanup()
  from public, anon, authenticated, service_role;
create trigger referral_case_attributions_guard_guest_cleanup
before insert or update on public.referral_case_attributions
for each row execute function public.guard_referral_attribution_guest_cleanup();

create or replace function public.is_abandoned_anonymous_guest_eligible(
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
      and not public.anonymous_guest_has_protected_referral(auth_user.id)
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

create or replace function public.claim_abandoned_anonymous_guest_cleanup_candidate(
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

    -- Unlike ordinary eligibility, protection also applies to old retry/auth-only
    -- snapshots. Previously started deletion is quarantined for manual review.
    if public.anonymous_guest_has_protected_referral(candidate.user_id) then
      update public.anonymous_guest_cleanup_candidates as cleanup_candidate
      set state = case when candidate.storage_deletion_started_at is null
            then 'cancelled' else 'blocked' end,
          eligibility_checked_at = v_now,
          lease_token = null,
          lease_expires_at = null,
          retry_after = null,
          last_error_code = 'PROTECTED_REFERRAL_HISTORY',
          last_run_id = cleanup_run_id
      where cleanup_candidate.user_id = candidate.user_id;
      insert into public.anonymous_guest_cleanup_events(run_id, user_id, event_type, details)
      values (cleanup_run_id, candidate.user_id,
        case when candidate.storage_deletion_started_at is null
          then 'candidate_cancelled' else 'candidate_blocked' end,
        jsonb_build_object('reason', 'PROTECTED_REFERRAL_HISTORY'));
      continue;
    end if;

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

create or replace function public.start_abandoned_anonymous_guest_storage_deletion(
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
  -- Match claim's row-lock/advisory-lock order. A lease issued before this
  -- migration must pass protection again before the worker can delete files.
  perform 1 from public.anonymous_guest_cleanup_candidates as candidate
  where candidate.user_id = candidate_user_id
    and candidate.state in ('executing', 'storage_retry')
    and candidate.lease_token = candidate_lease_token
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'The cleanup storage lease is no longer valid.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'venfour-anonymous-cleanup:' || candidate_user_id::text, 0));
  if public.anonymous_guest_has_protected_referral(candidate_user_id) then
    raise exception using errcode = '55000',
      message = 'Submitted referral history prevents anonymous guest cleanup.';
  end if;

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

-- Reassert the existing RPC boundary; the new helpers have no API grants.
revoke all on function public.is_abandoned_anonymous_guest_eligible(uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_abandoned_anonymous_guest_cleanup_candidate(uuid,uuid),
  public.start_abandoned_anonymous_guest_storage_deletion(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.claim_abandoned_anonymous_guest_cleanup_candidate(uuid,uuid),
  public.start_abandoned_anonymous_guest_storage_deletion(uuid,uuid) to service_role;
