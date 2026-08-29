-- Preview access is independent of the later paid-review eligibility rules.
alter table public.total_loss_analysis_jobs
  add column started_as_guest boolean not null default false;

create function public.record_total_loss_analysis_guest_origin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.started_as_guest := exists (
    select 1 from public.appraisal_cases as appraisal_case
    join auth.users as owner on owner.id = appraisal_case.user_id
    where appraisal_case.id = new.case_id and owner.is_anonymous is true
  );
  return new;
end;
$$;

create trigger total_loss_analysis_jobs_record_guest_origin
before insert on public.total_loss_analysis_jobs
for each row execute function public.record_total_loss_analysis_guest_origin();

-- Include in-flight guest analyses without emailing historical completions.
update public.total_loss_analysis_jobs as job
set started_as_guest = true
from public.appraisal_cases as appraisal_case
join auth.users as owner on owner.id = appraisal_case.user_id
where job.case_id = appraisal_case.id and job.status = 'processing'
  and owner.is_anonymous is true;

create table public.total_loss_preview_emails (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases(id) on delete cascade,
  run_id uuid references public.analysis_runs(id) on delete cascade,
  kind text not null check (kind in ('ready', 'recovery')),
  recipient_email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 8),
  next_attempt_at timestamptz not null default statement_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text check (last_error_code in ('EMAIL_UNAVAILABLE')),
  created_at timestamptz not null default statement_timestamp(),
  sent_at timestamptz,
  constraint total_loss_preview_emails_ready_run check (kind <> 'ready' or run_id is not null),
  constraint total_loss_preview_emails_lease check (
    (status = 'sending' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'sending' and lease_token is null and lease_expires_at is null)
  ),
  constraint total_loss_preview_emails_sent check ((status = 'sent') = (sent_at is not null))
);

create unique index total_loss_preview_emails_one_completion
  on public.total_loss_preview_emails(run_id) where kind = 'ready';
create index total_loss_preview_emails_due
  on public.total_loss_preview_emails(next_attempt_at, created_at)
  where status in ('pending', 'sending');

alter table public.total_loss_preview_emails enable row level security;
revoke all on public.total_loss_preview_emails from public, anon, authenticated, service_role;

create index total_loss_case_contacts_preview_email_idx
  on public.total_loss_case_contacts(email);

create function public.enqueue_total_loss_preview_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status
    and new.started_as_guest then
    insert into public.total_loss_preview_emails(case_id, run_id, kind, recipient_email)
    select new.case_id, new.run_id, 'ready', contact.email
    from public.total_loss_case_contacts as contact where contact.case_id = new.case_id
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger total_loss_analysis_jobs_queue_preview_email
after update of status on public.total_loss_analysis_jobs
for each row execute function public.enqueue_total_loss_preview_completion();

create function public.total_loss_preview_access_allowed_internal(requested_case_id uuid, email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.total_loss_case_operations_internal as operation
    join public.appraisal_cases as appraisal_case on appraisal_case.id = operation.case_id
    join public.total_loss_case_contacts as contact on contact.case_id = operation.case_id
    join auth.users as owner on owner.id = appraisal_case.user_id
    where operation.case_id = $1 and contact.email = $2
      and operation.case_stage in ('analysis_complete', 'analysis_processing', 'analysis_failed')
      and owner.deleted_at is null
      and (
        (owner.is_anonymous is true
          and public.total_loss_case_identity_transfer_allowed_internal($1)
          and not exists (
            select 1 from public.total_loss_case_identity_claims as claimed
            where claimed.case_id = $1 and claimed.claimed_at is not null
              and claimed.claimed_by_user_id is distinct from appraisal_case.user_id
          ))
        or (coalesce(owner.is_anonymous, false) is false
          and owner.email_confirmed_at is not null
          and lower(btrim(owner.email)) = contact.email)
      )
  );
$$;

create function public.request_total_loss_preview_recovery(
  requested_case_id uuid, email text, requester_fingerprint text, target_fingerprint text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  normalized_email text := lower(btrim(coalesce($2, '')));
  selected_case_id uuid;
  requester_allowed boolean := false;
  target_allowed boolean := false;
begin
  if coalesce($3, '') ~ '^[0-9a-f]{64}$' and coalesce($4, '') ~ '^[0-9a-f]{64}$' then
    requester_allowed := public.consume_total_loss_recovery_rate_limit_internal(
      'requester', $3, 5, interval '15 minutes');
    target_allowed := public.consume_total_loss_recovery_rate_limit_internal(
      'target', $4, 3, interval '15 minutes');
  end if;
  if not requester_allowed or not target_allowed
    or char_length(normalized_email) not between 3 and 320
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or normalized_email ~ '[[:cntrl:]]'
    or normalized_email ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
  then return; end if;

  select contact.case_id into selected_case_id
  from public.total_loss_case_contacts as contact
  join public.appraisal_cases as appraisal_case on appraisal_case.id = contact.case_id
  where contact.email = normalized_email
    and ($1 is null or contact.case_id = $1)
    and public.total_loss_preview_access_allowed_internal(contact.case_id, normalized_email)
  order by appraisal_case.last_activity_at desc, appraisal_case.id desc limit 1;
  if not found then return; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_preview_recovery'),
    pg_catalog.hashtext(selected_case_id::text));
  if exists (
    select 1 from public.total_loss_preview_emails as email_job
    where email_job.case_id = selected_case_id and email_job.recipient_email = normalized_email
      and email_job.status in ('pending', 'sending')
  ) then return; end if;
  insert into public.total_loss_preview_emails(case_id, kind, recipient_email)
  values (selected_case_id, 'recovery', normalized_email);
end;
$$;

create function public.reserve_total_loss_preview_email(requested_lease_token uuid, requested_case_id uuid default null)
returns table (email_id uuid, case_id uuid, recipient_email text, claim_id uuid, kind text)
language plpgsql security definer set search_path = '' as $$
declare
  email_job public.total_loss_preview_emails%rowtype;
  claim_row public.total_loss_case_identity_claims%rowtype;
  case_owner uuid;
  recorded_at timestamptz := statement_timestamp();
begin
  if $1 is null then raise exception 'An email delivery lease is required.'; end if;
  update public.total_loss_preview_emails as exhausted
  set status = 'failed', lease_token = null, lease_expires_at = null,
    last_error_code = 'EMAIL_UNAVAILABLE'
  where exhausted.status = 'sending' and exhausted.lease_expires_at <= recorded_at
    and exhausted.attempt_count >= 8;

  for email_job in
    select queued.* from public.total_loss_preview_emails as queued
    where (queued.status = 'pending'
      or (queued.status = 'sending' and queued.lease_expires_at <= recorded_at))
      and queued.next_attempt_at <= recorded_at and queued.attempt_count < 8
      and ($2 is null or queued.case_id = $2)
    order by queued.next_attempt_at, queued.created_at, queued.id
    limit 10 for update skip locked
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('total_loss_case_identity_transition'),
      pg_catalog.hashtext(email_job.case_id::text));
    select appraisal_case.user_id into case_owner from public.appraisal_cases as appraisal_case
    where appraisal_case.id = email_job.case_id for update;
    if not found or not public.total_loss_preview_access_allowed_internal(
      email_job.case_id, email_job.recipient_email)
      or (email_job.kind = 'ready' and not exists (
        select 1 from public.total_loss_case_operations_internal as operation
        where operation.case_id = email_job.case_id
          and operation.case_stage = 'analysis_complete'
          and operation.analysis_run_id = email_job.run_id
      )) then
      update public.total_loss_preview_emails set status = 'cancelled',
        lease_token = null, lease_expires_at = null where id = email_job.id;
      continue;
    end if;

    select identity_claim.* into claim_row
    from public.total_loss_case_identity_claims as identity_claim
    where identity_claim.case_id = email_job.case_id and identity_claim.purpose = 'intake'
      and identity_claim.source_user_id = case_owner
      and identity_claim.requested_email = email_job.recipient_email
      and identity_claim.claimed_at is null and identity_claim.revoked_at is null
      and identity_claim.expires_at > recorded_at + interval '5 minutes'
    for update;
    if not found then
      update public.total_loss_case_identity_claims as identity_claim
      set revoked_at = recorded_at
      where identity_claim.case_id = email_job.case_id and identity_claim.purpose = 'intake'
        and identity_claim.claimed_at is null and identity_claim.revoked_at is null;
      insert into public.total_loss_case_identity_claims(
        case_id, source_user_id, requested_email, purpose, expires_at)
      values (email_job.case_id, case_owner, email_job.recipient_email,
        'intake', recorded_at + interval '30 minutes') returning * into claim_row;
    end if;

    update public.total_loss_preview_emails as leased
    set status = 'sending', attempt_count = leased.attempt_count + 1,
      lease_token = $1, lease_expires_at = recorded_at + interval '2 minutes',
      last_error_code = null where leased.id = email_job.id;
    return query select email_job.id, email_job.case_id, email_job.recipient_email,
      claim_row.id, email_job.kind;
    return;
  end loop;
end;
$$;

create function public.finish_total_loss_preview_email(
  requested_email_id uuid, requested_lease_token uuid, delivered boolean
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if $3 is null then return false; end if;
  update public.total_loss_preview_emails as email_job
  set status = case when $3 then 'sent' when email_job.attempt_count >= 8 then 'failed' else 'pending' end,
    sent_at = case when $3 then statement_timestamp() else null end,
    lease_token = null, lease_expires_at = null,
    next_attempt_at = statement_timestamp() + make_interval(secs =>
      least(3600, 60 * power(2, email_job.attempt_count - 1)::integer)),
    last_error_code = case when $3 then null else 'EMAIL_UNAVAILABLE' end
  where email_job.id = $1 and email_job.lease_token = $2 and email_job.status = 'sending';
  return found;
end;
$$;

revoke execute on function public.record_total_loss_analysis_guest_origin() from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_total_loss_preview_completion() from public, anon, authenticated, service_role;
revoke execute on function public.total_loss_preview_access_allowed_internal(uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.request_total_loss_preview_recovery(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.reserve_total_loss_preview_email(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.finish_total_loss_preview_email(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.request_total_loss_preview_recovery(uuid, text, text, text) to service_role;
grant execute on function public.reserve_total_loss_preview_email(uuid, uuid) to service_role;
grant execute on function public.finish_total_loss_preview_email(uuid, uuid, boolean) to service_role;

-- The scheduler is inert until an operator configures both Vault entries.
-- It wakes a request-billed API even when no customer browser is open.
create function public.dispatch_total_loss_preview_emails()
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  api_origin text;
  dispatch_secret text;
  request_id bigint;
begin
  select decrypted_secret into api_origin from vault.decrypted_secrets
    where name = 'venfour_preview_email_api_origin';
  select decrypted_secret into dispatch_secret from vault.decrypted_secrets
    where name = 'venfour_preview_email_dispatch_secret';
  if api_origin is null or dispatch_secret is null then return null; end if;
  if api_origin !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$'
    or char_length(dispatch_secret) not between 32 and 512
    or dispatch_secret ~ '[[:space:][:cntrl:]]'
  then return null; end if;
  if not exists (
    select 1 from public.total_loss_preview_emails as queued
    where queued.next_attempt_at <= statement_timestamp()
      and (queued.status = 'pending' or
        (queued.status = 'sending' and queued.lease_expires_at <= statement_timestamp()))
  ) then return null; end if;
  select net.http_post(
    url := api_origin || '/internal/v1/preview-emails/dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'X-Venfour-Preview-Dispatch', dispatch_secret),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  ) into request_id;
  return request_id;
end;
$$;
revoke execute on function public.dispatch_total_loss_preview_emails() from public, anon, authenticated, service_role;

select cron.schedule('venfour-preview-email-delivery', '* * * * *',
  'select public.dispatch_total_loss_preview_emails();');
