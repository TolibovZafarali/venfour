-- Additive identity-claim support for dormant post-Continue secure/resume flows.

create type public.total_loss_case_identity_claim_purpose as enum (
  'intake',
  'post_continue'
);

comment on type public.total_loss_case_identity_claim_purpose is
  'Trusted server-side reason an opaque Total-Loss case identity claim was issued.';

revoke all on type public.total_loss_case_identity_claim_purpose
  from public, anon;
grant usage on type public.total_loss_case_identity_claim_purpose
  to authenticated, service_role;

alter table public.total_loss_case_identity_claims
add column purpose public.total_loss_case_identity_claim_purpose
  not null default 'intake';

comment on column public.total_loss_case_identity_claims.purpose is
  'Trusted claim purpose; historical and existing intake claims remain intake by default.';

drop index public.total_loss_case_identity_claims_one_live_idx;

create unique index total_loss_case_identity_claims_one_live_idx
  on public.total_loss_case_identity_claims (case_id, purpose)
  where claimed_at is null and revoked_at is null;

create type public.total_loss_case_claim_completion_context_result as (
  outcome text,
  case_id uuid,
  owner_user_id uuid,
  contact_email text,
  email_verified_at timestamptz,
  claimed_at timestamptz,
  ownership_transferred boolean,
  claim_purpose public.total_loss_case_identity_claim_purpose
);

create type public.total_loss_case_claim_resume_result as (
  state text,
  case_id uuid,
  contact_email text,
  workflow_phase text,
  workflow_current_task text,
  workflow_revision bigint
);

create type public.total_loss_case_claim_renewal_result as (
  state text,
  case_id uuid,
  contact_email text,
  claim_id uuid,
  claim_expires_at timestamptz
);

create type public.total_loss_case_access_recovery_result as (
  send_allowed boolean,
  claim_id uuid,
  claim_expires_at timestamptz,
  requested_email text
);

revoke all on type public.total_loss_case_claim_completion_context_result
  from public, anon;
grant usage on type public.total_loss_case_claim_completion_context_result
  to authenticated, service_role;
revoke all on type public.total_loss_case_claim_resume_result
  from public, anon;
grant usage on type public.total_loss_case_claim_resume_result
  to authenticated, service_role;
revoke all on type public.total_loss_case_claim_renewal_result
  from public, anon;
grant usage on type public.total_loss_case_claim_renewal_result
  to authenticated, service_role;
revoke all on type public.total_loss_case_access_recovery_result
  from public, anon, authenticated;
grant usage on type public.total_loss_case_access_recovery_result
  to service_role;

create table public.total_loss_case_access_recovery_rate_limits (
  scope text not null,
  fingerprint text not null,
  window_started_at timestamptz not null,
  attempt_count integer not null,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (scope, fingerprint),
  constraint total_loss_case_access_recovery_rate_limits_scope_valid
    check (scope in ('requester', 'target')),
  constraint total_loss_case_access_recovery_rate_limits_fingerprint_valid
    check (fingerprint ~ '^[0-9a-f]{64}$'),
  constraint total_loss_case_access_recovery_rate_limits_attempt_count_positive
    check (attempt_count >= 1)
);

comment on table public.total_loss_case_access_recovery_rate_limits is
  'Private fixed-window recovery throttles containing only keyed, non-reversible fingerprints.';
comment on column public.total_loss_case_access_recovery_rate_limits.fingerprint is
  'Server-generated keyed hash; raw network, email, and case identifiers are prohibited.';

alter table public.total_loss_case_access_recovery_rate_limits
enable row level security;

revoke all on table public.total_loss_case_access_recovery_rate_limits
  from public, anon, authenticated, service_role;

create function public.total_loss_post_continue_case_is_eligible_internal(
  requested_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.total_loss_case_operations_internal as operation
    join public.total_loss_preliminary_snapshots as snapshot
      on snapshot.case_id = operation.case_id
      and snapshot.analysis_job_id = operation.analysis_job_id
      and snapshot.analysis_run_id = operation.analysis_run_id
      and snapshot.source_intake_mode = operation.intake_mode
      and snapshot.source_analysis_input_revision =
        operation.analysis_input_revision
      and snapshot.source_analysis_input_id is not distinct from
        operation.analysis_input_id
      and (
        (
          operation.intake_mode = 'report'
          and snapshot.source_report_upload_id = operation.report_last_upload_id
        )
        or (
          operation.intake_mode = 'manual'
          and snapshot.source_report_upload_id is null
        )
      )
    where operation.case_id = $1
      and operation.service_type = 'total_loss'
      and operation.case_stage = 'analysis_complete'
      and snapshot.preliminary_classification = operation.analysis_classification
      and snapshot.preliminary_classification in (
        'MATERIAL_UNDERVALUE_SIGNAL',
        'POTENTIAL_UNDERVALUE'
      )
  );
$$;

comment on function public.total_loss_post_continue_case_is_eligible_internal(uuid) is
  'Internal current-input-fenced eligibility predicate requiring an immutable matching preliminary snapshot for one of the two classifications that can enter secure-claim.';

revoke execute on function
  public.total_loss_post_continue_case_is_eligible_internal(uuid)
  from public, anon, authenticated, service_role;

create function public.total_loss_case_identity_transfer_allowed_internal(
  requested_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not exists (
      select 1
      from public.commerce_orders as commerce_order
      where commerce_order.case_id = $1
    )
    and not exists (
      select 1
      from public.payment_transactions as payment_transaction
      where payment_transaction.case_id = $1
    )
    and not exists (
      select 1
      from public.case_entitlements as entitlement
      where entitlement.case_id = $1
    )
    and not exists (
      select 1
      from public.total_loss_report_versions as report_version
      where report_version.case_id = $1
        and report_version.status = 'published'
    )
    and not exists (
      select 1
      from public.total_loss_claim_workflows as workflow
      where workflow.case_id = $1
        and (
          workflow.phase is distinct from 'review'
          or workflow.current_task is distinct from 'secure_claim'
        )
    );
$$;

comment on function public.total_loss_case_identity_transfer_allowed_internal(uuid) is
  'Internal conservative transfer fence: no commerce, financial, entitlement, or published-report state and no workflow beyond exact review/secure_claim.';

revoke execute on function
  public.total_loss_case_identity_transfer_allowed_internal(uuid)
  from public, anon, authenticated, service_role;

create function public.lock_total_loss_case_identity_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(new.case_id::text)
  );
  return new;
end;
$$;

comment on function public.lock_total_loss_case_identity_transition() is
  'Trigger-only case lock serializing commerce/workflow creation and advancement with identity transfer checks.';

revoke execute on function public.lock_total_loss_case_identity_transition()
  from public, anon, authenticated, service_role;

create trigger total_loss_claim_workflows_lock_identity_transition
before insert or update on public.total_loss_claim_workflows
for each row execute function public.lock_total_loss_case_identity_transition();

create function public.guard_total_loss_commerce_order_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(new.case_id::text)
  );

  if not exists (
    select 1
    from public.appraisal_cases as appraisal_case
    join auth.users as purchaser
      on purchaser.id = appraisal_case.user_id
    where appraisal_case.id = new.case_id
      and appraisal_case.service_type = 'total_loss'
      and appraisal_case.user_id = new.purchaser_user_id
      and not coalesce(purchaser.is_anonymous, false)
      and purchaser.email_confirmed_at is not null
      and nullif(btrim(purchaser.email), '') is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Commerce orders require the verified permanent current case owner.';
  end if;

  return new;
end;
$$;

comment on function public.guard_total_loss_commerce_order_identity() is
  'Trigger-only advisory-lock guard binding every commerce order to the verified permanent current case owner.';

revoke execute on function public.guard_total_loss_commerce_order_identity()
  from public, anon, authenticated, service_role;

create trigger commerce_orders_lock_identity_transition
before insert or update on public.commerce_orders
for each row execute function public.guard_total_loss_commerce_order_identity();

create function public.consume_total_loss_recovery_rate_limit_internal(
  requested_scope text,
  requested_fingerprint text,
  requested_limit integer,
  requested_window interval
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  recorded_at timestamptz := statement_timestamp();
  resulting_count integer;
begin
  insert into public.total_loss_case_access_recovery_rate_limits (
    scope,
    fingerprint,
    window_started_at,
    attempt_count,
    updated_at
  )
  values (
    $1,
    $2,
    recorded_at,
    1,
    recorded_at
  )
  on conflict (scope, fingerprint) do update
  set
    window_started_at = case
      when total_loss_case_access_recovery_rate_limits.window_started_at
        <= recorded_at - $4
        then recorded_at
      else total_loss_case_access_recovery_rate_limits.window_started_at
    end,
    attempt_count = case
      when total_loss_case_access_recovery_rate_limits.window_started_at
        <= recorded_at - $4
        then 1
      else total_loss_case_access_recovery_rate_limits.attempt_count + 1
    end,
    updated_at = recorded_at
  returning attempt_count into resulting_count;

  return resulting_count <= $3;
end;
$$;

comment on function public.consume_total_loss_recovery_rate_limit_internal(text, text, integer, interval) is
  'Internal atomic fixed-window keyed-fingerprint throttle.';

revoke execute on function
  public.consume_total_loss_recovery_rate_limit_internal(text, text, integer, interval)
  from public, anon, authenticated, service_role;

create or replace function public.save_total_loss_contact_and_begin_claim(
  case_id uuid,
  full_name text,
  email text,
  service_terms_version text,
  privacy_notice_version text,
  operational_follow_up_allowed boolean
)
returns setof public.total_loss_case_claim_begin_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  normalized_full_name text;
  normalized_email text;
  recorded_at timestamptz := statement_timestamp();
  contact_row public.total_loss_case_contacts%rowtype;
  claim_row public.total_loss_case_identity_claims%rowtype;
  result_row public.total_loss_case_claim_begin_result;
begin
  if authenticated_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to save Total-Loss contact information.';
  end if;

  normalized_full_name := regexp_replace(
    btrim(coalesce($2, '')),
    '[[:space:]]+',
    ' ',
    'g'
  );
  normalized_email := lower(btrim(coalesce($3, '')));

  if char_length(normalized_full_name) not between 1 and 200
    or normalized_full_name ~ '[[:cntrl:]]'
    or normalized_full_name ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
  then
    raise exception using
      errcode = '22023',
      message = 'A safe full name between 1 and 200 characters is required.';
  end if;

  if char_length(normalized_email) not between 3 and 320
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or normalized_email ~ '[[:cntrl:]]'
    or normalized_email ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
  then
    raise exception using
      errcode = '22023',
      message = 'A valid email address is required.';
  end if;

  if $4 is distinct from '2026-08-23'::text
    or $5 is distinct from '2026-08-23'::text
  then
    raise exception using
      errcode = '22023',
      message = 'The current service and privacy versions must be acknowledged.';
  end if;

  if $6 is null then
    raise exception using
      errcode = '22023',
      message = 'An explicit optional follow-up preference is required.';
  end if;

  perform 1
  from public.appraisal_cases as appraisal_case
  join public.total_loss_case_details as details
    on details.case_id = appraisal_case.id
  where appraisal_case.id = $1
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss'
    and appraisal_case.status = 'draft'
  for update of appraisal_case;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The Total-Loss draft is unavailable for contact confirmation.';
  end if;

  insert into public.total_loss_case_contacts (
    case_id,
    full_name,
    email,
    email_verified_at,
    service_terms_version,
    service_terms_acknowledged_at,
    privacy_notice_version,
    privacy_notice_acknowledged_at,
    operational_follow_up_allowed,
    operational_follow_up_updated_at
  )
  values (
    $1,
    normalized_full_name,
    normalized_email,
    null,
    $4,
    recorded_at,
    $5,
    recorded_at,
    $6,
    recorded_at
  )
  on conflict on constraint total_loss_case_contacts_pkey do update
  set
    full_name = excluded.full_name,
    email = excluded.email,
    email_verified_at = null,
    service_terms_version = excluded.service_terms_version,
    service_terms_acknowledged_at = case
      when total_loss_case_contacts.service_terms_version
        is distinct from excluded.service_terms_version
        then excluded.service_terms_acknowledged_at
      else total_loss_case_contacts.service_terms_acknowledged_at
    end,
    privacy_notice_version = excluded.privacy_notice_version,
    privacy_notice_acknowledged_at = case
      when total_loss_case_contacts.privacy_notice_version
        is distinct from excluded.privacy_notice_version
        then excluded.privacy_notice_acknowledged_at
      else total_loss_case_contacts.privacy_notice_acknowledged_at
    end,
    operational_follow_up_allowed = excluded.operational_follow_up_allowed,
    operational_follow_up_updated_at = case
      when total_loss_case_contacts.operational_follow_up_allowed
        is distinct from excluded.operational_follow_up_allowed
        then excluded.operational_follow_up_updated_at
      else total_loss_case_contacts.operational_follow_up_updated_at
    end
  returning * into contact_row;

  select identity_claim.*
  into claim_row
  from public.total_loss_case_identity_claims as identity_claim
  where identity_claim.case_id = $1
    and identity_claim.purpose = 'intake'
    and identity_claim.source_user_id = authenticated_user_id
    and identity_claim.requested_email = normalized_email
    and identity_claim.claimed_at is null
    and identity_claim.revoked_at is null
    and identity_claim.expires_at > recorded_at
  for update;

  if not found then
    update public.total_loss_case_identity_claims as identity_claim
    set revoked_at = recorded_at
    where identity_claim.case_id = $1
      and identity_claim.purpose = 'intake'
      and identity_claim.claimed_at is null
      and identity_claim.revoked_at is null;

    insert into public.total_loss_case_identity_claims (
      case_id,
      source_user_id,
      requested_email,
      purpose,
      expires_at
    )
    values (
      $1,
      authenticated_user_id,
      normalized_email,
      'intake',
      recorded_at + interval '30 minutes'
    )
    returning * into claim_row;
  end if;

  result_row.case_id := $1;
  result_row.full_name := contact_row.full_name;
  result_row.email := contact_row.email;
  result_row.email_verified_at := contact_row.email_verified_at;
  result_row.service_terms_version := contact_row.service_terms_version;
  result_row.service_terms_acknowledged_at :=
    contact_row.service_terms_acknowledged_at;
  result_row.privacy_notice_version := contact_row.privacy_notice_version;
  result_row.privacy_notice_acknowledged_at :=
    contact_row.privacy_notice_acknowledged_at;
  result_row.operational_follow_up_allowed :=
    contact_row.operational_follow_up_allowed;
  result_row.operational_follow_up_updated_at :=
    contact_row.operational_follow_up_updated_at;
  result_row.created_at := contact_row.created_at;
  result_row.updated_at := contact_row.updated_at;
  result_row.claim_id := claim_row.id;
  result_row.claim_expires_at := claim_row.expires_at;
  return next result_row;
end;
$$;

comment on function public.save_total_loss_contact_and_begin_claim(uuid, text, text, text, text, boolean) is
  'Preserves the existing intake contact/claim contract while limiting reuse and revocation to intake-purpose claims.';

create function public.resolve_total_loss_case_claim(requested_case_id uuid)
returns setof public.total_loss_case_claim_resume_result
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  authenticated_user auth.users%rowtype;
  contact_row public.total_loss_case_contacts%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  result_row public.total_loss_case_claim_resume_result;
begin
  if authenticated_user_id is null or $1 is null then
    return;
  end if;

  select auth_user.*
  into authenticated_user
  from auth.users as auth_user
  where auth_user.id = authenticated_user_id;

  if not found then
    return;
  end if;

  select contact.*
  into contact_row
  from public.appraisal_cases as appraisal_case
  join public.total_loss_case_contacts as contact
    on contact.case_id = appraisal_case.id
  where appraisal_case.id = $1
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss';

  if not found
    or not public.total_loss_post_continue_case_is_eligible_internal($1)
  then
    return;
  end if;

  select workflow.*
  into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = $1;

  if coalesce(authenticated_user.is_anonymous, false) then
    if not public.total_loss_case_identity_transfer_allowed_internal($1) then
      return;
    end if;
    result_row.state := 'secure_required';
  elsif authenticated_user.email_confirmed_at is not null
    and nullif(btrim(authenticated_user.email), '') is not null
    and lower(btrim(authenticated_user.email)) = contact_row.email
  then
    result_row.state := 'secured';
  else
    result_row.state := 'account_mismatch';
  end if;

  result_row.case_id := $1;
  result_row.contact_email := contact_row.email;
  result_row.workflow_phase := workflow_row.phase::text;
  result_row.workflow_current_task := workflow_row.current_task;
  result_row.workflow_revision := workflow_row.revision;
  return next result_row;
end;
$$;

comment on function public.resolve_total_loss_case_claim(uuid) is
  'Owner-safe authoritative secure/resume projection for an eligible completed Total-Loss case.';

revoke execute on function public.resolve_total_loss_case_claim(uuid)
  from public, anon;
grant execute on function public.resolve_total_loss_case_claim(uuid)
  to authenticated;
revoke execute on function public.resolve_total_loss_case_claim(uuid)
  from service_role;

create function public.renew_total_loss_case_claim(requested_case_id uuid)
returns setof public.total_loss_case_claim_renewal_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  authenticated_user auth.users%rowtype;
  contact_row public.total_loss_case_contacts%rowtype;
  claim_row public.total_loss_case_identity_claims%rowtype;
  recorded_at timestamptz := statement_timestamp();
  result_row public.total_loss_case_claim_renewal_result;
begin
  if authenticated_user_id is null or $1 is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext($1::text)
  );

  select auth_user.*
  into authenticated_user
  from auth.users as auth_user
  where auth_user.id = authenticated_user_id
  for share;

  if not found then
    return;
  end if;

  select contact.*
  into contact_row
  from public.appraisal_cases as appraisal_case
  join public.total_loss_case_contacts as contact
    on contact.case_id = appraisal_case.id
  where appraisal_case.id = $1
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss'
  for update of appraisal_case, contact;

  if not found
    or not public.total_loss_post_continue_case_is_eligible_internal($1)
  then
    return;
  end if;

  result_row.case_id := $1;
  result_row.contact_email := contact_row.email;

  if not coalesce(authenticated_user.is_anonymous, false) then
    if authenticated_user.email_confirmed_at is not null
      and nullif(btrim(authenticated_user.email), '') is not null
      and lower(btrim(authenticated_user.email)) = contact_row.email
    then
      result_row.state := 'secured';
    else
      result_row.state := 'account_mismatch';
    end if;
    return next result_row;
    return;
  end if;

  if not public.total_loss_case_identity_transfer_allowed_internal($1) then
    return;
  end if;

  select identity_claim.*
  into claim_row
  from public.total_loss_case_identity_claims as identity_claim
  where identity_claim.case_id = $1
    and identity_claim.purpose = 'post_continue'
    and identity_claim.source_user_id = authenticated_user_id
    and identity_claim.requested_email = contact_row.email
    and identity_claim.claimed_at is null
    and identity_claim.revoked_at is null
    and identity_claim.expires_at > recorded_at
  for update;

  if not found then
    update public.total_loss_case_identity_claims as identity_claim
    set revoked_at = recorded_at
    where identity_claim.case_id = $1
      and identity_claim.purpose = 'post_continue'
      and identity_claim.claimed_at is null
      and identity_claim.revoked_at is null;

    insert into public.total_loss_case_identity_claims (
      case_id,
      source_user_id,
      requested_email,
      purpose,
      expires_at
    )
    values (
      $1,
      authenticated_user_id,
      contact_row.email,
      'post_continue',
      recorded_at + interval '30 minutes'
    )
    returning * into claim_row;
  end if;

  result_row.state := 'secure_required';
  result_row.claim_id := claim_row.id;
  result_row.claim_expires_at := claim_row.expires_at;
  return next result_row;
end;
$$;

comment on function public.renew_total_loss_case_claim(uuid) is
  'Issues or reuses a post-Continue claim only for the eligible anonymous current owner and returns bounded permanent-owner states without accepting replacement identity data.';

revoke execute on function public.renew_total_loss_case_claim(uuid)
  from public, anon;
grant execute on function public.renew_total_loss_case_claim(uuid)
  to authenticated;
revoke execute on function public.renew_total_loss_case_claim(uuid)
  from service_role;

create function public.prepare_total_loss_case_access_recovery(
  requested_case_id uuid,
  email text,
  requester_fingerprint text,
  target_fingerprint text
)
returns setof public.total_loss_case_access_recovery_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(coalesce($2, '')));
  requester_allowed boolean := false;
  target_allowed boolean := false;
  owner_user auth.users%rowtype;
  case_owner_user_id uuid;
  contact_row public.total_loss_case_contacts%rowtype;
  claim_row public.total_loss_case_identity_claims%rowtype;
  recorded_at timestamptz := statement_timestamp();
  result_row public.total_loss_case_access_recovery_result;
begin
  result_row.send_allowed := false;

  if coalesce($3, '') ~ '^[0-9a-f]{64}$'
    and coalesce($4, '') ~ '^[0-9a-f]{64}$'
  then
    requester_allowed :=
      public.consume_total_loss_recovery_rate_limit_internal(
        'requester', $3, 5, interval '15 minutes'
      );
    target_allowed :=
      public.consume_total_loss_recovery_rate_limit_internal(
        'target', $4, 3, interval '15 minutes'
      );
  end if;

  if not requester_allowed or not target_allowed
    or $1 is null
    or char_length(normalized_email) not between 3 and 320
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or normalized_email ~ '[[:cntrl:]]'
    or normalized_email ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
  then
    return next result_row;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext($1::text)
  );

  select appraisal_case.user_id
  into case_owner_user_id
  from public.appraisal_cases as appraisal_case
  where appraisal_case.id = $1
    and appraisal_case.service_type = 'total_loss'
  for update;

  if not found then
    return next result_row;
    return;
  end if;

  select contact.*
  into contact_row
  from public.total_loss_case_contacts as contact
  where contact.case_id = $1
    and contact.email = normalized_email
  for update;

  if not found
    or not public.total_loss_post_continue_case_is_eligible_internal($1)
  then
    return next result_row;
    return;
  end if;

  select auth_user.*
  into owner_user
  from auth.users as auth_user
  where auth_user.id = case_owner_user_id
  for share;

  if not found then
    return next result_row;
    return;
  end if;

  if coalesce(owner_user.is_anonymous, false) then
    if not public.total_loss_case_identity_transfer_allowed_internal($1)
      or exists (
        select 1
        from public.total_loss_case_identity_claims as completed_claim
        where completed_claim.case_id = $1
          and completed_claim.claimed_at is not null
          and completed_claim.claimed_by_user_id is distinct from
            case_owner_user_id
      )
    then
      return next result_row;
      return;
    end if;
  elsif owner_user.email_confirmed_at is null
    or nullif(btrim(owner_user.email), '') is null
    or lower(btrim(owner_user.email)) <> contact_row.email
  then
    return next result_row;
    return;
  end if;

  select identity_claim.*
  into claim_row
  from public.total_loss_case_identity_claims as identity_claim
  where identity_claim.case_id = $1
    and identity_claim.purpose = 'post_continue'
    and identity_claim.source_user_id = case_owner_user_id
    and identity_claim.requested_email = normalized_email
    and identity_claim.claimed_at is null
    and identity_claim.revoked_at is null
    and identity_claim.expires_at > recorded_at
  for update;

  if not found then
    update public.total_loss_case_identity_claims as identity_claim
    set revoked_at = recorded_at
    where identity_claim.case_id = $1
      and identity_claim.purpose = 'post_continue'
      and identity_claim.claimed_at is null
      and identity_claim.revoked_at is null;

    insert into public.total_loss_case_identity_claims (
      case_id,
      source_user_id,
      requested_email,
      purpose,
      expires_at
    )
    values (
      $1,
      case_owner_user_id,
      normalized_email,
      'post_continue',
      recorded_at + interval '30 minutes'
    )
    returning * into claim_row;
  end if;

  result_row.send_allowed := true;
  result_row.claim_id := claim_row.id;
  result_row.claim_expires_at := claim_row.expires_at;
  result_row.requested_email := normalized_email;
  return next result_row;
end;
$$;

comment on function public.prepare_total_loss_case_access_recovery(uuid, text, text, text) is
  'Service-only enumeration-safe recovery preparation using exact stored identity, current eligibility, conservative transfer state, and keyed-fingerprint throttles.';

revoke execute on function
  public.prepare_total_loss_case_access_recovery(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function
  public.prepare_total_loss_case_access_recovery(uuid, text, text, text)
  to service_role;

create function public.complete_total_loss_case_claim_internal(claim_id uuid)
returns setof public.total_loss_case_claim_completion_context_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  destination_user auth.users%rowtype;
  claim_row public.total_loss_case_identity_claims%rowtype;
  case_row public.appraisal_cases%rowtype;
  contact_row public.total_loss_case_contacts%rowtype;
  claim_case_id uuid;
  claim_source_user_id uuid;
  claim_requested_email text;
  claim_purpose public.total_loss_case_identity_claim_purpose;
  completed_at timestamptz := statement_timestamp();
  transferred boolean := false;
  result_row public.total_loss_case_claim_completion_context_result;
begin
  if authenticated_user_id is null or $1 is null then
    raise exception using
      errcode = '42501',
      message = 'The Total-Loss case claim is unavailable.';
  end if;

  select auth_user.*
  into destination_user
  from auth.users as auth_user
  where auth_user.id = authenticated_user_id
  for share;

  if not found
    or coalesce(destination_user.is_anonymous, false)
    or destination_user.email_confirmed_at is null
    or nullif(btrim(destination_user.email), '') is null
  then
    raise exception using
      errcode = '42501',
      message = 'The Total-Loss case claim is unavailable.';
  end if;

  select identity_claim.*
  into claim_row
  from public.total_loss_case_identity_claims as identity_claim
  where identity_claim.id = $1;

  if not found
    or claim_row.revoked_at is not null
    or lower(btrim(destination_user.email)) <> claim_row.requested_email
  then
    raise exception using
      errcode = '42501',
      message = 'The Total-Loss case claim is unavailable.';
  end if;

  claim_case_id := claim_row.case_id;
  claim_source_user_id := claim_row.source_user_id;
  claim_requested_email := claim_row.requested_email;
  claim_purpose := claim_row.purpose;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_case_identity_transition'),
    pg_catalog.hashtext(claim_case_id::text)
  );

  select appraisal_case.*
  into case_row
  from public.appraisal_cases as appraisal_case
  where appraisal_case.id = claim_case_id
    and appraisal_case.service_type = 'total_loss'
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The Total-Loss case claim is unavailable.';
  end if;

  select contact.*
  into contact_row
  from public.total_loss_case_contacts as contact
  where contact.case_id = claim_case_id
    and contact.email = claim_requested_email
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The Total-Loss case claim is unavailable.';
  end if;

  select identity_claim.*
  into claim_row
  from public.total_loss_case_identity_claims as identity_claim
  where identity_claim.id = $1
  for update;

  if not found
    or claim_row.case_id is distinct from claim_case_id
    or claim_row.source_user_id is distinct from claim_source_user_id
    or claim_row.requested_email is distinct from claim_requested_email
    or claim_row.purpose is distinct from claim_purpose
    or claim_row.revoked_at is not null
    or lower(btrim(destination_user.email)) <> claim_row.requested_email
  then
    raise exception using
      errcode = '42501',
      message = 'The Total-Loss case claim is unavailable.';
  end if;

  if claim_row.claimed_at is not null then
    if claim_row.claimed_by_user_id is distinct from authenticated_user_id
      or case_row.user_id is distinct from authenticated_user_id
    then
      raise exception using
        errcode = '42501',
        message = 'The Total-Loss case claim is unavailable.';
    end if;

    result_row.outcome := 'already_claimed';
    result_row.case_id := claim_row.case_id;
    result_row.owner_user_id := authenticated_user_id;
    result_row.contact_email := contact_row.email;
    result_row.email_verified_at := contact_row.email_verified_at;
    result_row.claimed_at := claim_row.claimed_at;
    result_row.ownership_transferred := false;
    result_row.claim_purpose := claim_row.purpose;
    return next result_row;
    return;
  end if;

  if claim_row.expires_at <= completed_at
    or case_row.user_id is distinct from claim_row.source_user_id
    or (
      claim_row.purpose = 'post_continue'
      and not public.total_loss_post_continue_case_is_eligible_internal(
        claim_row.case_id
      )
    )
  then
    raise exception using
      errcode = '42501',
      message = 'The Total-Loss case claim is unavailable.';
  end if;

  if case_row.user_id is distinct from authenticated_user_id then
    if not public.total_loss_case_identity_transfer_allowed_internal(
      claim_row.case_id
    ) then
      raise exception using
        errcode = '42501',
        message = 'The Total-Loss case claim is unavailable.';
    end if;

    update public.appraisal_cases as appraisal_case
    set
      user_id = authenticated_user_id,
      last_activity_at = completed_at
    where appraisal_case.id = case_row.id
      and appraisal_case.user_id = claim_row.source_user_id;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'The Total-Loss case claim is unavailable.';
    end if;

    transferred := true;
  end if;

  update public.total_loss_case_contacts as contact
  set email_verified_at = completed_at
  where contact.case_id = claim_row.case_id
  returning * into contact_row;

  update public.total_loss_case_identity_claims as identity_claim
  set
    claimed_by_user_id = authenticated_user_id,
    claimed_at = completed_at
  where identity_claim.id = claim_row.id;

  insert into public.profiles (
    id,
    display_name,
    full_name_confirmed_at,
    service_terms_version,
    service_terms_acknowledged_at,
    privacy_notice_version,
    privacy_notice_acknowledged_at,
    operational_follow_up_allowed,
    operational_follow_up_updated_at
  )
  values (
    authenticated_user_id,
    contact_row.full_name,
    completed_at,
    contact_row.service_terms_version,
    contact_row.service_terms_acknowledged_at,
    contact_row.privacy_notice_version,
    contact_row.privacy_notice_acknowledged_at,
    contact_row.operational_follow_up_allowed,
    contact_row.operational_follow_up_updated_at
  )
  on conflict (id) do update
  set
    display_name = case
      when profiles.full_name_confirmed_at is null then excluded.display_name
      else profiles.display_name
    end,
    full_name_confirmed_at = case
      when profiles.full_name_confirmed_at is null
        then excluded.full_name_confirmed_at
      else profiles.full_name_confirmed_at
    end,
    service_terms_version = coalesce(
      profiles.service_terms_version,
      excluded.service_terms_version
    ),
    service_terms_acknowledged_at = coalesce(
      profiles.service_terms_acknowledged_at,
      excluded.service_terms_acknowledged_at
    ),
    privacy_notice_version = coalesce(
      profiles.privacy_notice_version,
      excluded.privacy_notice_version
    ),
    privacy_notice_acknowledged_at = coalesce(
      profiles.privacy_notice_acknowledged_at,
      excluded.privacy_notice_acknowledged_at
    ),
    operational_follow_up_allowed = coalesce(
      profiles.operational_follow_up_allowed,
      excluded.operational_follow_up_allowed
    ),
    operational_follow_up_updated_at = coalesce(
      profiles.operational_follow_up_updated_at,
      excluded.operational_follow_up_updated_at
    );

  result_row.outcome := 'claimed';
  result_row.case_id := claim_row.case_id;
  result_row.owner_user_id := authenticated_user_id;
  result_row.contact_email := contact_row.email;
  result_row.email_verified_at := contact_row.email_verified_at;
  result_row.claimed_at := completed_at;
  result_row.ownership_transferred := transferred;
  result_row.claim_purpose := claim_row.purpose;
  return next result_row;
end;
$$;

comment on function public.complete_total_loss_case_claim_internal(uuid) is
  'Internal purpose-aware claim completion with current-source eligibility, exact-email, replay, and future paid-ownership transfer fences.';

revoke execute on function public.complete_total_loss_case_claim_internal(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.complete_total_loss_case_claim(claim_id uuid)
returns setof public.total_loss_case_claim_result
language sql
volatile
security definer
set search_path = ''
as $$
  select
    completion.outcome,
    completion.case_id,
    completion.owner_user_id,
    completion.contact_email,
    completion.email_verified_at,
    completion.claimed_at,
    completion.ownership_transferred
  from public.complete_total_loss_case_claim_internal($1) as completion;
$$;

comment on function public.complete_total_loss_case_claim(uuid) is
  'Backward-compatible intake claim completion projection over the purpose-aware hardened completion contract.';

revoke execute on function public.complete_total_loss_case_claim(uuid)
  from public, anon;
grant execute on function public.complete_total_loss_case_claim(uuid)
  to authenticated;
revoke execute on function public.complete_total_loss_case_claim(uuid)
  from service_role;

create function public.complete_total_loss_case_claim_with_context(claim_id uuid)
returns setof public.total_loss_case_claim_completion_context_result
language sql
volatile
security definer
set search_path = ''
as $$
  select *
  from public.complete_total_loss_case_claim_internal($1);
$$;

comment on function public.complete_total_loss_case_claim_with_context(uuid) is
  'Purpose-aware claim completion whose trusted purpose and case ID determine callback routing.';

revoke execute on function
  public.complete_total_loss_case_claim_with_context(uuid)
  from public, anon;
grant execute on function
  public.complete_total_loss_case_claim_with_context(uuid)
  to authenticated;
revoke execute on function
  public.complete_total_loss_case_claim_with_context(uuid)
  from service_role;
