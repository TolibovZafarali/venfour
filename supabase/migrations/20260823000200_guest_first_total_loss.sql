-- Guest-first Total Loss ownership, contact claiming, provider-neutral inputs,
-- and transfer-safe report storage. Diminished Value keeps its existing
-- database-backed authorization and document protocol.

create function public.current_auth_user_is_anonymous()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth_user.is_anonymous, false)
  from auth.users as auth_user
  where auth_user.id = (select auth.uid());
$$;

comment on function public.current_auth_user_is_anonymous() is
  'Returns the database-backed anonymous-identity state for the current authenticated Auth user.';

revoke execute on function public.current_auth_user_is_anonymous() from public;
revoke execute on function public.current_auth_user_is_anonymous() from anon;
grant execute on function public.current_auth_user_is_anonymous() to authenticated;
revoke execute on function public.current_auth_user_is_anonymous() from service_role;

drop policy if exists "Customers can create their own cases"
on public.appraisal_cases;

create policy "Customers can create their own cases"
on public.appraisal_cases
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and (
    service_type = 'total_loss'
    or (
      service_type = 'diminished_value'
      and not (select public.current_auth_user_is_anonymous())
    )
  )
);

comment on policy "Customers can create their own cases"
on public.appraisal_cases is
  'Authenticated users can create owned Total-Loss drafts; only permanent authenticated users can create owned Diminished Value drafts.';

drop policy if exists "Customers can create their own total-loss details"
on public.total_loss_case_details;

create policy "Customers can create their own total-loss details"
on public.total_loss_case_details
for insert
to authenticated
with check (
  exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = total_loss_case_details.case_id
      and appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'total_loss'
      and appraisal_case.status = 'draft'
  )
);

comment on policy "Customers can create their own total-loss details"
on public.total_loss_case_details is
  'A customer can attach Total-Loss details only to an owned draft parent.';

drop policy if exists "Customers can update their own total-loss details"
on public.total_loss_case_details;

create policy "Customers can update their own total-loss details"
on public.total_loss_case_details
for update
to authenticated
using (
  exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = total_loss_case_details.case_id
      and appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'total_loss'
      and appraisal_case.status = 'draft'
  )
)
with check (
  exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = total_loss_case_details.case_id
      and appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'total_loss'
      and appraisal_case.status = 'draft'
  )
);

comment on policy "Customers can update their own total-loss details"
on public.total_loss_case_details is
  'Customer Total-Loss inputs are editable only while the owned parent remains draft; processing and completed inputs are immutable.';

create or replace function public.get_or_create_total_loss_draft()
returns public.appraisal_cases
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  case_row public.appraisal_cases%rowtype;
begin
  if authenticated_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to prepare a total-loss draft.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'venfour:total-loss-draft:' || authenticated_user_id::text,
      0
    )
  );

  select appraisal_case.*
  into case_row
  from public.appraisal_cases as appraisal_case
  where appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss'
    and appraisal_case.status = 'draft'
  order by
    appraisal_case.last_activity_at desc,
    appraisal_case.created_at desc,
    appraisal_case.id desc
  limit 1
  for update;

  if found then
    return case_row;
  end if;

  insert into public.appraisal_cases (user_id, service_type)
  values (authenticated_user_id, 'total_loss')
  returning * into case_row;

  return case_row;
end;
$$;

comment on function public.get_or_create_total_loss_draft() is
  'Advisory-locks and resolves the newest owned Total-Loss draft for any authenticated Auth identity, including an anonymous Auth user, without requiring profile confirmation.';

create table public.total_loss_case_contacts (
  case_id uuid primary key references public.appraisal_cases (id) on delete cascade,
  full_name text not null,
  email text not null,
  email_verified_at timestamptz,
  service_terms_version text not null,
  service_terms_acknowledged_at timestamptz not null,
  privacy_notice_version text not null,
  privacy_notice_acknowledged_at timestamptz not null,
  operational_follow_up_allowed boolean not null,
  operational_follow_up_updated_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_case_contacts_full_name_safe
    check (
      char_length(full_name) between 1 and 200
      and full_name = regexp_replace(btrim(full_name), '[[:space:]]+', ' ', 'g')
      and full_name !~ '[[:cntrl:]]'
      and full_name !~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    ),
  constraint total_loss_case_contacts_email_safe
    check (
      char_length(email) between 3 and 320
      and email = lower(btrim(email))
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and email !~ '[[:cntrl:]]'
      and email !~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    ),
  constraint total_loss_case_contacts_terms_current
    check (service_terms_version = '2026-08-23'),
  constraint total_loss_case_contacts_privacy_current
    check (privacy_notice_version = '2026-08-23')
);

comment on table public.total_loss_case_contacts is
  'Case-scoped Total-Loss contact, legal acknowledgement, and optional follow-up facts. Entered email remains unverified until the claim-completion workflow verifies it against Auth.';
comment on column public.total_loss_case_contacts.email_verified_at is
  'Database time when a non-anonymous Auth destination with this exact verified email completed the opaque case claim; browser input never sets this value.';

create trigger total_loss_case_contacts_set_updated_at
before update on public.total_loss_case_contacts
for each row execute function public.set_updated_at();

alter table public.total_loss_case_contacts enable row level security;

create policy "Customers can read contact for their own total-loss case"
on public.total_loss_case_contacts
for select
to authenticated
using (
  exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = total_loss_case_contacts.case_id
      and appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'total_loss'
  )
);

revoke all on table public.total_loss_case_contacts from public;
revoke all on table public.total_loss_case_contacts from anon;
revoke all on table public.total_loss_case_contacts from authenticated;
revoke all on table public.total_loss_case_contacts from service_role;
grant select on table public.total_loss_case_contacts to authenticated;
grant select, insert, update, delete on table public.total_loss_case_contacts to service_role;

create table public.total_loss_case_identity_claims (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.appraisal_cases (id) on delete cascade,
  source_user_id uuid not null,
  requested_email text not null,
  expires_at timestamptz not null,
  claimed_by_user_id uuid,
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint total_loss_case_identity_claims_email_safe
    check (
      char_length(requested_email) between 3 and 320
      and requested_email = lower(btrim(requested_email))
      and requested_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and requested_email !~ '[[:cntrl:]]'
      and requested_email !~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    ),
  constraint total_loss_case_identity_claims_expiry_valid
    check (expires_at > created_at),
  constraint total_loss_case_identity_claims_terminal_state
    check (
      (
        claimed_by_user_id is null
        and claimed_at is null
        and revoked_at is null
      )
      or (
        claimed_by_user_id is not null
        and claimed_at is not null
        and revoked_at is null
      )
      or (
        claimed_by_user_id is null
        and claimed_at is null
        and revoked_at is not null
      )
    )
);

create unique index total_loss_case_identity_claims_one_live_idx
  on public.total_loss_case_identity_claims (case_id)
  where claimed_at is null and revoked_at is null;

create index total_loss_case_identity_claims_source_idx
  on public.total_loss_case_identity_claims (source_user_id, created_at desc);

comment on table public.total_loss_case_identity_claims is
  'Private opaque, expiring, single-use capabilities that bind a Total-Loss case and unchanged source owner to one normalized requested email.';

alter table public.total_loss_case_identity_claims enable row level security;

revoke all on table public.total_loss_case_identity_claims from public;
revoke all on table public.total_loss_case_identity_claims from anon;
revoke all on table public.total_loss_case_identity_claims from authenticated;
revoke all on table public.total_loss_case_identity_claims from service_role;

create type public.total_loss_case_claim_begin_result as (
  case_id uuid,
  full_name text,
  email text,
  email_verified_at timestamptz,
  service_terms_version text,
  service_terms_acknowledged_at timestamptz,
  privacy_notice_version text,
  privacy_notice_acknowledged_at timestamptz,
  operational_follow_up_allowed boolean,
  operational_follow_up_updated_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  claim_id uuid,
  claim_expires_at timestamptz
);

create type public.total_loss_case_claim_result as (
  outcome text,
  case_id uuid,
  owner_user_id uuid,
  contact_email text,
  email_verified_at timestamptz,
  claimed_at timestamptz,
  ownership_transferred boolean
);

revoke all on type public.total_loss_case_claim_begin_result from public;
revoke all on type public.total_loss_case_claim_begin_result from anon;
grant usage on type public.total_loss_case_claim_begin_result to authenticated, service_role;
revoke all on type public.total_loss_case_claim_result from public;
revoke all on type public.total_loss_case_claim_result from anon;
grant usage on type public.total_loss_case_claim_result to authenticated, service_role;

create function public.save_total_loss_contact_and_begin_claim(
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
  on conflict (case_id) do update
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
      and identity_claim.claimed_at is null
      and identity_claim.revoked_at is null;

    insert into public.total_loss_case_identity_claims (
      case_id,
      source_user_id,
      requested_email,
      expires_at
    )
    values (
      $1,
      authenticated_user_id,
      normalized_email,
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
  'Saves normalized case-scoped contact and database-timestamped legal facts for an owned draft, explicitly resets email verification, and returns an opaque expiring claim without disclosing whether the email already has an account.';

create function public.complete_total_loss_case_claim(claim_id uuid)
returns setof public.total_loss_case_claim_result
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
  completed_at timestamptz := statement_timestamp();
  transferred boolean := false;
  result_row public.total_loss_case_claim_result;
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
    return next result_row;
    return;
  end if;

  if claim_row.expires_at <= completed_at
    or case_row.user_id is distinct from claim_row.source_user_id
  then
    raise exception using
      errcode = '42501',
      message = 'The Total-Loss case claim is unavailable.';
  end if;

  if case_row.user_id is distinct from authenticated_user_id then
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
  return next result_row;
end;
$$;

comment on function public.complete_total_loss_case_claim(uuid) is
  'Consumes an opaque claim only for a permanent authenticated user whose verified Auth email exactly matches the requested email, locks the unchanged source ownership, transfers the parent case atomically, and permits only an exact destination replay.';

revoke execute on function public.save_total_loss_contact_and_begin_claim(uuid, text, text, text, text, boolean) from public;
revoke execute on function public.save_total_loss_contact_and_begin_claim(uuid, text, text, text, text, boolean) from anon;
grant execute on function public.save_total_loss_contact_and_begin_claim(uuid, text, text, text, text, boolean) to authenticated;
revoke execute on function public.save_total_loss_contact_and_begin_claim(uuid, text, text, text, text, boolean) from service_role;

revoke execute on function public.complete_total_loss_case_claim(uuid) from public;
revoke execute on function public.complete_total_loss_case_claim(uuid) from anon;
grant execute on function public.complete_total_loss_case_claim(uuid) to authenticated;
revoke execute on function public.complete_total_loss_case_claim(uuid) from service_role;

alter table public.total_loss_case_details
add column report_storage_owner_id uuid,
add column vehicle_condition text,
add column vehicle_options_packages text,
add column report_provider_name text,
add column report_extraction_status text not null default 'not_requested',
add column report_extraction_confidence numeric(5, 4),
add column report_extracted_at timestamptz,
add column report_extraction_source_upload_id uuid,
add column report_extraction_input_revision bigint,
add column analysis_input_revision bigint not null default 1,
add column analysis_input_id uuid not null default gen_random_uuid(),
add column report_facts_confirmed_at timestamptz,
add constraint total_loss_case_details_vehicle_condition_safe
  check (
    vehicle_condition is null
    or (
      char_length(btrim(vehicle_condition)) between 1 and 2000
      and vehicle_condition !~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    )
  ),
add constraint total_loss_case_details_options_packages_safe
  check (
    vehicle_options_packages is null
    or (
      char_length(btrim(vehicle_options_packages)) between 1 and 4000
      and vehicle_options_packages !~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    )
  ),
add constraint total_loss_case_details_report_provider_safe
  check (
    report_provider_name is null
    or (
      char_length(btrim(report_provider_name)) between 1 and 200
      and report_provider_name !~ '[[:cntrl:]]'
      and report_provider_name !~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    )
  ),
add constraint total_loss_case_details_extraction_status_valid
  check (
    report_extraction_status in (
      'not_requested',
      'pending',
      'needs_confirmation',
      'confirmed',
      'failed'
    )
  ),
add constraint total_loss_case_details_extraction_confidence_valid
  check (
    report_extraction_confidence is null
    or report_extraction_confidence between 0 and 1
  ),
add constraint total_loss_case_details_extraction_source_complete
  check (
    (
      report_extraction_source_upload_id is null
      and report_extraction_input_revision is null
      and report_extracted_at is null
      and report_extraction_confidence is null
      and report_extraction_status in ('not_requested', 'pending')
    )
    or (
      report_extraction_source_upload_id is not null
      and report_extraction_input_revision is not null
      and report_extracted_at is not null
      and report_extraction_status in (
        'needs_confirmation',
        'confirmed',
        'failed'
      )
    )
  ),
add constraint total_loss_case_details_analysis_input_revision_valid
  check (analysis_input_revision >= 1);

update public.total_loss_case_details as details
set report_storage_owner_id = appraisal_case.user_id
from public.appraisal_cases as appraisal_case
where appraisal_case.id = details.case_id;

alter table public.total_loss_case_details
alter column report_storage_owner_id set not null;

comment on column public.total_loss_case_details.report_storage_owner_id is
  'Immutable UUID namespace snapshot used by the canonical and backup report paths. It intentionally does not change when case ownership transfers.';
comment on column public.total_loss_case_details.vehicle_condition is
  'Customer-confirmed vehicle condition relevant to provider-neutral valuation.';
comment on column public.total_loss_case_details.vehicle_options_packages is
  'Explicit customer response about material options and packages; a truthful no-options response is valid.';
comment on column public.total_loss_case_details.report_provider_name is
  'Bounded provider metadata produced by the trusted extraction boundary when detectable; NULL represents unknown provider.';
comment on column public.total_loss_case_details.analysis_input_revision is
  'Server-owned monotonic version for material customer-confirmed analysis inputs and finalized report identity.';
comment on column public.total_loss_case_details.analysis_input_id is
  'Server-owned opaque fence rotated whenever material analysis input or confirmation changes.';
comment on column public.total_loss_case_details.report_facts_confirmed_at is
  'Database time when the customer confirmed the current report-derived facts; NULL for manual intake.';

create function public.protect_total_loss_storage_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_owner_id uuid;
begin
  if tg_op = 'INSERT' then
    select appraisal_case.user_id
    into parent_owner_id
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = new.case_id
      and appraisal_case.service_type = 'total_loss';

    if not found then
      raise exception using
        errcode = '23503',
        message = 'A Total-Loss parent case is required.';
    end if;

    if new.report_storage_owner_id is not null
      and new.report_storage_owner_id is distinct from parent_owner_id
    then
      raise exception using
        errcode = '42501',
        message = 'The report storage namespace is server-owned.';
    end if;

    new.report_storage_owner_id := parent_owner_id;
  elsif new.report_storage_owner_id is distinct from old.report_storage_owner_id then
    raise exception using
      errcode = '42501',
      message = 'The report storage namespace is immutable.';
  end if;

  return new;
end;
$$;

comment on function public.protect_total_loss_storage_owner() is
  'Trigger-only guard that snapshots the parent owner into a transfer-safe report namespace and rejects every later change.';

revoke execute on function public.protect_total_loss_storage_owner() from public;
revoke execute on function public.protect_total_loss_storage_owner() from anon;
revoke execute on function public.protect_total_loss_storage_owner() from authenticated;
revoke execute on function public.protect_total_loss_storage_owner() from service_role;

create trigger total_loss_case_details_protect_storage_owner
before insert or update on public.total_loss_case_details
for each row execute function public.protect_total_loss_storage_owner();

create or replace function public.set_total_loss_case_details_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  customer_input_changed boolean;
begin
  customer_input_changed := row(
    new.intake_mode,
    new.vin,
    new.vehicle_year,
    new.vehicle_make,
    new.vehicle_model,
    new.vehicle_trim,
    new.mileage_at_loss,
    new.postal_code,
    new.date_of_loss,
    new.insurer_name,
    new.insurer_vehicle_valuation,
    new.vehicle_condition,
    new.vehicle_options_packages,
    new.report_original_filename,
    new.report_uploaded_at,
    new.report_last_upload_id
  ) is distinct from row(
    old.intake_mode,
    old.vin,
    old.vehicle_year,
    old.vehicle_make,
    old.vehicle_model,
    old.vehicle_trim,
    old.mileage_at_loss,
    old.postal_code,
    old.date_of_loss,
    old.insurer_name,
    old.insurer_vehicle_valuation,
    old.vehicle_condition,
    old.vehicle_options_packages,
    old.report_original_filename,
    old.report_uploaded_at,
    old.report_last_upload_id
  );

  if customer_input_changed
    or row(
      new.intake_completed_at,
      new.report_facts_confirmed_at
    ) is distinct from row(
      old.intake_completed_at,
      old.report_facts_confirmed_at
    )
  then
    new.updated_at := statement_timestamp();
    new.analysis_input_revision := old.analysis_input_revision + 1;
    new.analysis_input_id := gen_random_uuid();

    if customer_input_changed then
      new.intake_completed_at := null;
      new.report_facts_confirmed_at := null;
      new.report_extraction_status := case
        when new.intake_mode = 'report'
          and new.report_last_upload_id is not null
          then 'pending'
        else 'not_requested'
      end;
      new.report_extraction_confidence := null;
      new.report_extracted_at := null;
      new.report_extraction_source_upload_id := null;
      new.report_extraction_input_revision := null;

      if new.intake_mode <> 'report' then
        new.report_provider_name := null;
      end if;
    end if;
  else
    new.updated_at := old.updated_at;
    new.analysis_input_revision := old.analysis_input_revision;
    new.analysis_input_id := old.analysis_input_id;
  end if;

  return new;
end;
$$;

comment on function public.set_total_loss_case_details_updated_at() is
  'Advances customer-visible and opaque analysis fences for material changes, clears prior confirmation and stale extraction metadata after customer-input changes, and keeps lease/extraction coordination version-neutral.';

grant select (
  report_storage_owner_id,
  vehicle_condition,
  vehicle_options_packages,
  report_provider_name,
  report_extraction_status,
  report_extraction_confidence,
  report_extracted_at,
  analysis_input_revision,
  analysis_input_id,
  report_facts_confirmed_at
) on public.total_loss_case_details to authenticated;

grant insert (
  vehicle_condition,
  vehicle_options_packages
) on public.total_loss_case_details to authenticated;

grant update (
  vehicle_condition,
  vehicle_options_packages
) on public.total_loss_case_details to authenticated;

revoke insert (intake_completed_at)
on public.total_loss_case_details from authenticated;
revoke update (intake_completed_at)
on public.total_loss_case_details from authenticated;

create function public.total_loss_manual_input_is_complete(
  details public.total_loss_case_details
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    $1.intake_mode = 'manual'
    and $1.intake_completed_at is not null
    and $1.vehicle_year is not null
    and $1.vehicle_year between 1886
      and extract(year from current_date)::integer + 1
    and nullif(btrim($1.vehicle_make), '') is not null
    and nullif(btrim($1.vehicle_model), '') is not null
    and nullif(btrim($1.vehicle_trim), '') is not null
    and $1.mileage_at_loss is not null
    and $1.mileage_at_loss >= 0
    and nullif(btrim($1.postal_code), '') is not null
    and $1.postal_code ~ '^[0-9]{5}(-[0-9]{4})?$'
    and $1.date_of_loss is not null
    and nullif(btrim($1.insurer_name), '') is not null
    and nullif(btrim($1.vehicle_condition), '') is not null
    and nullif(btrim($1.vehicle_options_packages), '') is not null;
$$;

comment on function public.total_loss_manual_input_is_complete(public.total_loss_case_details) is
  'Deterministically validates the confirmed minimum manual analysis inputs; VIN and insurer offer remain optional, while trim, condition, and an explicit options/packages response are required.';

revoke execute on function public.total_loss_manual_input_is_complete(public.total_loss_case_details) from public;
revoke execute on function public.total_loss_manual_input_is_complete(public.total_loss_case_details) from anon;
revoke execute on function public.total_loss_manual_input_is_complete(public.total_loss_case_details) from authenticated;
revoke execute on function public.total_loss_manual_input_is_complete(public.total_loss_case_details) from service_role;

create function public.build_total_loss_analysis_input_snapshot(
  details public.total_loss_case_details
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'case_id', $1.case_id,
    'intake_mode', $1.intake_mode,
    'vin', $1.vin,
    'vehicle_year', $1.vehicle_year,
    'vehicle_make', $1.vehicle_make,
    'vehicle_model', $1.vehicle_model,
    'vehicle_trim', $1.vehicle_trim,
    'mileage_at_loss', $1.mileage_at_loss,
    'postal_code', nullif(btrim($1.postal_code), ''),
    'date_of_loss', $1.date_of_loss,
    'insurer_name', $1.insurer_name,
    'insurer_vehicle_valuation', $1.insurer_vehicle_valuation,
    'vehicle_condition', $1.vehicle_condition,
    'vehicle_options_packages', $1.vehicle_options_packages,
    'report_provider_name', $1.report_provider_name,
    'analysis_input_revision', $1.analysis_input_revision,
    'analysis_input_id', $1.analysis_input_id,
    'intake_completed_at', $1.intake_completed_at
  );
$$;

comment on function public.build_total_loss_analysis_input_snapshot(public.total_loss_case_details) is
  'Builds the bounded, provider-neutral, customer-confirmed input snapshot returned only through trusted analysis coordination.';

revoke execute on function public.build_total_loss_analysis_input_snapshot(public.total_loss_case_details) from public;
revoke execute on function public.build_total_loss_analysis_input_snapshot(public.total_loss_case_details) from anon;
revoke execute on function public.build_total_loss_analysis_input_snapshot(public.total_loss_case_details) from authenticated;
revoke execute on function public.build_total_loss_analysis_input_snapshot(public.total_loss_case_details) from service_role;

create type public.total_loss_intake_confirmation_result as (
  case_id uuid,
  intake_mode public.total_loss_intake_mode,
  vin text,
  vehicle_year smallint,
  vehicle_make text,
  vehicle_model text,
  vehicle_trim text,
  mileage_at_loss integer,
  postal_code text,
  date_of_loss date,
  insurer_name text,
  insurer_vehicle_valuation numeric(12, 2),
  vehicle_condition text,
  vehicle_options_packages text,
  report_provider_name text,
  report_original_filename text,
  report_uploaded_at timestamptz,
  report_facts_confirmed_at timestamptz,
  intake_completed_at timestamptz,
  analysis_input_revision bigint,
  analysis_input_id uuid,
  updated_at timestamptz
);

revoke all on type public.total_loss_intake_confirmation_result from public;
revoke all on type public.total_loss_intake_confirmation_result from anon;
grant usage on type public.total_loss_intake_confirmation_result to authenticated, service_role;

create function public.confirm_total_loss_intake(
  case_id uuid,
  expected_details_updated_at timestamptz
)
returns setof public.total_loss_intake_confirmation_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  details_row public.total_loss_case_details%rowtype;
  contact_row public.total_loss_case_contacts%rowtype;
  confirmed_at timestamptz := statement_timestamp();
  canonical_path text;
  confirmed_source_revision bigint;
  confirmed_source_input_id uuid;
  cached_extraction_found boolean := false;
  cached_extraction_status text;
  cached_extraction_provider text;
  cached_extraction_confidence numeric(5, 4);
  cached_extraction_extracted_at timestamptz;
begin
  if authenticated_user_id is null or $1 is null or $2 is null then
    raise exception using
      errcode = '42501',
      message = 'The Total-Loss intake is unavailable for confirmation.';
  end if;

  perform 1
  from public.appraisal_cases as appraisal_case
  where appraisal_case.id = $1
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss'
    and appraisal_case.status = 'draft'
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The Total-Loss intake is unavailable for confirmation.';
  end if;

  select details.*
  into details_row
  from public.total_loss_case_details as details
  where details.case_id = $1
  for update;

  if not found or details_row.updated_at is distinct from $2 then
    raise exception using
      errcode = '40001',
      message = 'The Total-Loss details changed before confirmation.';
  end if;

  select contact.*
  into contact_row
  from public.total_loss_case_contacts as contact
  where contact.case_id = $1
    and contact.service_terms_version = '2026-08-23'
    and contact.service_terms_acknowledged_at is not null
    and contact.privacy_notice_version = '2026-08-23'
    and contact.privacy_notice_acknowledged_at is not null
    and contact.operational_follow_up_allowed is not null
    and contact.operational_follow_up_updated_at is not null
  for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Current contact, legal acknowledgement, and follow-up preference are required.';
  end if;

  if details_row.vehicle_year is null
    or details_row.vehicle_year < 1886
    or details_row.vehicle_year > extract(year from current_date)::integer + 1
    or nullif(btrim(details_row.vehicle_make), '') is null
    or nullif(btrim(details_row.vehicle_model), '') is null
    or nullif(btrim(details_row.vehicle_trim), '') is null
    or details_row.mileage_at_loss is null
    or details_row.mileage_at_loss < 0
    or nullif(btrim(details_row.postal_code), '') is null
    or details_row.postal_code !~ '^[0-9]{5}(-[0-9]{4})?$'
    or details_row.date_of_loss is null
    or nullif(btrim(details_row.insurer_name), '') is null
    or nullif(btrim(details_row.vehicle_condition), '') is null
    or nullif(btrim(details_row.vehicle_options_packages), '') is null
  then
    raise exception using
      errcode = '22023',
      message = 'Complete every required vehicle and claim fact before confirmation.';
  end if;

  if details_row.intake_mode = 'report' then
    canonical_path := details_row.report_storage_owner_id::text || '/'
      || details_row.case_id::text || '/valuation-report.pdf';

    if details_row.report_upload_id is not null
      or details_row.report_last_upload_id is null
      or details_row.report_original_filename is null
      or details_row.report_uploaded_at is null
      or not exists (
        select 1
        from storage.objects as stored_object
        where stored_object.bucket_id = 'case-files'
          and stored_object.name = canonical_path
          and stored_object.user_metadata ->> 'uploadId'
            = details_row.report_last_upload_id::text
      )
    then
      raise exception using
        errcode = '22023',
        message = 'A finalized current valuation report is required.';
    end if;

    confirmed_source_revision := details_row.analysis_input_revision;
    confirmed_source_input_id := details_row.analysis_input_id;

    select
      extraction.extraction_status,
      extraction.provider_name,
      extraction.confidence,
      extraction.extracted_at
    into
      cached_extraction_status,
      cached_extraction_provider,
      cached_extraction_confidence,
      cached_extraction_extracted_at
    from public.total_loss_report_extractions as extraction
    where extraction.case_id = details_row.case_id
      and extraction.report_upload_id = details_row.report_last_upload_id
      and extraction.analysis_input_revision =
        details_row.analysis_input_revision
      and extraction.analysis_input_id = details_row.analysis_input_id
    for update;
    cached_extraction_found := found;

    if cached_extraction_found and (
      details_row.report_extraction_source_upload_id is distinct from
        details_row.report_last_upload_id
      or details_row.report_extraction_input_revision is distinct from
        details_row.analysis_input_revision
      or details_row.report_extraction_status is distinct from
        cached_extraction_status
      or details_row.report_provider_name is distinct from
        cached_extraction_provider
      or details_row.report_extraction_confidence is distinct from
        cached_extraction_confidence
      or details_row.report_extracted_at is distinct from
        cached_extraction_extracted_at
    ) then
      raise exception using
        errcode = '55000',
        message = 'The current report extraction metadata is inconsistent.';
    elsif not cached_extraction_found and (
      details_row.report_extraction_source_upload_id is not null
      or details_row.report_extraction_input_revision is not null
      or details_row.report_extraction_status in (
        'needs_confirmation',
        'confirmed',
        'failed'
      )
    ) then
      raise exception using
        errcode = '55000',
        message = 'The current report extraction metadata is inconsistent.';
    end if;
  elsif details_row.intake_mode <> 'manual' then
    raise exception using
      errcode = '22023',
      message = 'A supported Total-Loss intake mode is required.';
  end if;

  update public.total_loss_case_details as details
  set
    intake_completed_at = confirmed_at,
    report_facts_confirmed_at = case
      when details.intake_mode = 'report' then confirmed_at
      else null
    end
  where details.case_id = $1
  returning details.* into details_row;

  if cached_extraction_found then
    cached_extraction_status := case
      when cached_extraction_status = 'needs_confirmation' then 'confirmed'
      else cached_extraction_status
    end;

    update public.total_loss_report_extractions as extraction
    set
      analysis_input_revision = details_row.analysis_input_revision,
      analysis_input_id = details_row.analysis_input_id,
      extraction_status = cached_extraction_status,
      updated_at = confirmed_at
    where extraction.case_id = details_row.case_id
      and extraction.report_upload_id = details_row.report_last_upload_id
      and extraction.analysis_input_revision = confirmed_source_revision
      and extraction.analysis_input_id = confirmed_source_input_id;

    if not found then
      raise exception using
        errcode = '55000',
        message = 'The current report extraction changed during confirmation.';
    end if;

    update public.total_loss_case_details as details
    set
      report_provider_name = cached_extraction_provider,
      report_extraction_status = cached_extraction_status,
      report_extraction_confidence = cached_extraction_confidence,
      report_extracted_at = cached_extraction_extracted_at,
      report_extraction_source_upload_id = details.report_last_upload_id,
      report_extraction_input_revision = details.analysis_input_revision
    where details.case_id = $1
      and details.analysis_input_revision = details_row.analysis_input_revision
      and details.analysis_input_id = details_row.analysis_input_id
    returning details.* into details_row;

    if not found then
      raise exception using
        errcode = '55000',
        message = 'The current report extraction changed during confirmation.';
    end if;
  end if;

  update public.appraisal_cases as appraisal_case
  set last_activity_at = confirmed_at
  where appraisal_case.id = $1
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss'
    and appraisal_case.status = 'draft';

  if not found then
    raise exception using
      errcode = '55000',
      message = 'The Total-Loss draft could not be touched after confirmation.';
  end if;

  return query
  select
    details_row.case_id,
    details_row.intake_mode,
    details_row.vin,
    details_row.vehicle_year,
    details_row.vehicle_make,
    details_row.vehicle_model,
    details_row.vehicle_trim,
    details_row.mileage_at_loss,
    details_row.postal_code,
    details_row.date_of_loss,
    details_row.insurer_name,
    details_row.insurer_vehicle_valuation,
    details_row.vehicle_condition,
    details_row.vehicle_options_packages,
    details_row.report_provider_name,
    details_row.report_original_filename,
    details_row.report_uploaded_at,
    details_row.report_facts_confirmed_at,
    details_row.intake_completed_at,
    details_row.analysis_input_revision,
    details_row.analysis_input_id,
    details_row.updated_at;
end;
$$;

comment on function public.confirm_total_loss_intake(uuid, timestamptz) is
  'Locks an owned draft, validates current legal/input/report facts, database-stamps confirmation, rotates analysis fences, and atomically promotes an exact needs-confirmation extraction while allowing absent or failed extraction with complete manual facts.';

revoke execute on function public.confirm_total_loss_intake(uuid, timestamptz) from public;
revoke execute on function public.confirm_total_loss_intake(uuid, timestamptz) from anon;
grant execute on function public.confirm_total_loss_intake(uuid, timestamptz) to authenticated;
revoke execute on function public.confirm_total_loss_intake(uuid, timestamptz) from service_role;

create function public.get_owned_total_loss_report_storage_locator(case_id uuid)
returns table (
  case_id uuid,
  bucket_id text,
  storage_owner_id uuid,
  canonical_object_path text,
  backup_object_path text,
  finalized_upload_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    details.case_id,
    'case-files'::text,
    details.report_storage_owner_id,
    details.report_storage_owner_id::text || '/' || details.case_id::text
      || '/valuation-report.pdf',
    details.report_storage_owner_id::text || '/' || details.case_id::text
      || '/valuation-report-backup.pdf',
    details.report_last_upload_id
  from public.total_loss_case_details as details
  join public.appraisal_cases as appraisal_case
    on appraisal_case.id = details.case_id
  where details.case_id = $1
    and appraisal_case.user_id = (select auth.uid())
    and appraisal_case.service_type = 'total_loss';
$$;

comment on function public.get_owned_total_loss_report_storage_locator(uuid) is
  'Returns only the deterministic private report locator for the current case owner while preserving the immutable namespace across ownership transfer.';

revoke execute on function public.get_owned_total_loss_report_storage_locator(uuid) from public;
revoke execute on function public.get_owned_total_loss_report_storage_locator(uuid) from anon;
grant execute on function public.get_owned_total_loss_report_storage_locator(uuid) to authenticated;
revoke execute on function public.get_owned_total_loss_report_storage_locator(uuid) from service_role;

create or replace function public.mark_total_loss_report_upload_ready(
  case_id uuid,
  upload_id uuid,
  has_backup boolean
)
returns setof public.total_loss_report_upload_lease
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  details_row public.total_loss_case_details%rowtype;
  backup_path text;
begin
  if authenticated_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to prepare a report upload.';
  end if;

  if $2 is null or $3 is null then
    raise exception using
      errcode = '22023',
      message = 'A report-upload attempt identifier and backup state are required.';
  end if;

  perform 1
  from public.appraisal_cases as appraisal_case
  where appraisal_case.id = $1
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss'
    and appraisal_case.status = 'draft'
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The report-upload case is unavailable for this account.';
  end if;

  select details.*
  into details_row
  from public.total_loss_case_details as details
  where details.case_id = $1
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The report-upload case is unavailable for this account.';
  end if;

  if details_row.report_upload_id is distinct from $2 then
    raise exception using
      errcode = '55000',
      message = 'The report-upload lease is no longer active.';
  end if;

  if details_row.report_upload_phase = 'ready'
    and details_row.report_upload_has_backup = $3 then
    update public.total_loss_case_details as details
    set report_upload_expires_at = statement_timestamp() + interval '30 minutes'
    where details.case_id = $1
    returning details.* into details_row;

    return query
    select
      details_row.report_upload_id,
      details_row.report_upload_expires_at,
      details_row.report_upload_details_updated_at,
      details_row.report_original_filename,
      details_row.report_uploaded_at,
      false;
    return;
  end if;

  if details_row.report_upload_phase <> 'preparing' then
    raise exception using
      errcode = '55000',
      message = 'The report-upload lease is in the wrong phase.';
  end if;

  if $3 then
    backup_path := details_row.report_storage_owner_id::text || '/' || $1::text
      || '/valuation-report-backup.pdf';

    if not exists (
      select 1
      from storage.objects as stored_object
      where stored_object.bucket_id = 'case-files'
        and stored_object.name = backup_path
        and stored_object.user_metadata ->> 'uploadId' = $2::text
    ) then
      raise exception using
        errcode = '55000',
        message = 'The recoverable report backup is not ready.';
    end if;
  elsif details_row.report_original_filename is not null
    or details_row.report_uploaded_at is not null then
    raise exception using
      errcode = '55000',
      message = 'A committed report must be backed up before replacement.';
  end if;

  update public.total_loss_case_details as details
  set
    report_upload_phase = 'ready',
    report_upload_has_backup = $3,
    report_upload_expires_at = statement_timestamp() + interval '30 minutes'
  where details.case_id = $1
  returning details.* into details_row;

  return query
  select
    details_row.report_upload_id,
    details_row.report_upload_expires_at,
    details_row.report_upload_details_updated_at,
    details_row.report_original_filename,
    details_row.report_uploaded_at,
    false;
end;
$$;

comment on function public.mark_total_loss_report_upload_ready(uuid, uuid, boolean) is
  'Moves a preparing upload to ready only after any required token-matched backup exists in the case immutable report namespace.';

create or replace function public.complete_total_loss_report_upload_recovery(
  case_id uuid,
  upload_id uuid
)
returns setof public.total_loss_report_upload_lease
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  details_row public.total_loss_case_details%rowtype;
  canonical_path text;
  backup_path text;
begin
  if authenticated_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to recover a report upload.';
  end if;

  if $2 is null then
    raise exception using
      errcode = '22023',
      message = 'A report-upload attempt identifier is required.';
  end if;

  perform 1
  from public.appraisal_cases as appraisal_case
  where appraisal_case.id = $1
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss'
    and appraisal_case.status = 'draft'
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The report-upload case is unavailable for this account.';
  end if;

  select details.*
  into details_row
  from public.total_loss_case_details as details
  where details.case_id = $1
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The report-upload case is unavailable for this account.';
  end if;

  if details_row.report_upload_id is distinct from $2 then
    raise exception using
      errcode = '55000',
      message = 'The report-upload lease is no longer active.';
  end if;

  if details_row.report_upload_phase = 'preparing'
    and not details_row.report_upload_has_backup then
    return query
    select
      details_row.report_upload_id,
      details_row.report_upload_expires_at,
      details_row.report_upload_details_updated_at,
      details_row.report_original_filename,
      details_row.report_uploaded_at,
      false;
    return;
  end if;

  if details_row.report_upload_phase not in ('ready', 'recovering')
    or not details_row.report_upload_has_backup then
    raise exception using
      errcode = '55000',
      message = 'The report-upload lease is not recoverable.';
  end if;

  canonical_path := details_row.report_storage_owner_id::text || '/' || $1::text
    || '/valuation-report.pdf';
  backup_path := details_row.report_storage_owner_id::text || '/' || $1::text
    || '/valuation-report-backup.pdf';

  if not exists (
    select 1
    from storage.objects as stored_object
    where stored_object.bucket_id = 'case-files'
      and stored_object.name = canonical_path
      and stored_object.user_metadata ->> 'uploadId' = $2::text
  ) or not exists (
    select 1
    from storage.objects as stored_object
    where stored_object.bucket_id = 'case-files'
      and stored_object.name = backup_path
      and stored_object.user_metadata ->> 'uploadId' = $2::text
  ) then
    raise exception using
      errcode = '55000',
      message = 'The report objects do not match the active recovery token.';
  end if;

  update public.total_loss_case_details as details
  set
    report_upload_phase = 'preparing',
    report_upload_has_backup = false,
    report_upload_expires_at = statement_timestamp() + interval '30 minutes'
  where details.case_id = $1
  returning details.* into details_row;

  return query
  select
    details_row.report_upload_id,
    details_row.report_upload_expires_at,
    details_row.report_upload_details_updated_at,
    details_row.report_original_filename,
    details_row.report_uploaded_at,
    false;
end;
$$;

comment on function public.complete_total_loss_report_upload_recovery(uuid, uuid) is
  'Confirms token-matched restoration in the immutable report namespace before permitting another replacement attempt.';

create or replace function public.finalize_total_loss_report_upload(
  case_id uuid,
  upload_id uuid,
  report_original_filename text,
  report_uploaded_at timestamptz
)
returns setof public.total_loss_case_details_public
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  details_row public.total_loss_case_details%rowtype;
  parent_status public.appraisal_case_status;
  public_row public.total_loss_case_details_public;
  canonical_path text;
begin
  if authenticated_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to finalize a report upload.';
  end if;

  if $2 is null then
    raise exception using
      errcode = '22023',
      message = 'A report-upload attempt identifier is required.';
  end if;

  select appraisal_case.status
  into parent_status
  from public.appraisal_cases as appraisal_case
  where appraisal_case.id = $1
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss'
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The report-upload case is unavailable for this account.';
  end if;

  select details.*
  into details_row
  from public.total_loss_case_details as details
  where details.case_id = $1
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The report-upload case is unavailable for this account.';
  end if;

  if details_row.report_upload_id is null
    and details_row.report_last_upload_id = $2 then
    select
      details_row.case_id,
      details_row.intake_mode,
      details_row.vin,
      details_row.vehicle_year,
      details_row.vehicle_make,
      details_row.vehicle_model,
      details_row.vehicle_trim,
      details_row.mileage_at_loss,
      details_row.postal_code,
      details_row.date_of_loss,
      details_row.insurer_name,
      details_row.insurer_vehicle_valuation,
      details_row.report_original_filename,
      details_row.report_uploaded_at,
      details_row.intake_completed_at,
      details_row.created_at,
      details_row.updated_at
    into public_row;
    return next public_row;
    return;
  end if;

  if parent_status <> 'draft' then
    raise exception using
      errcode = '42501',
      message = 'The report-upload case is no longer a draft.';
  end if;

  if details_row.report_upload_id is distinct from $2
    or details_row.report_upload_phase <> 'ready' then
    raise exception using
      errcode = '55000',
      message = 'The report-upload lease is no longer ready to finalize.';
  end if;

  if details_row.updated_at is distinct from
    details_row.report_upload_details_updated_at then
    raise exception using
      errcode = '40001',
      message = 'The total-loss details changed during the report upload.';
  end if;

  if nullif(btrim($3), '') is null
    or char_length($3) > 255
    or $3 <> regexp_replace(btrim($3), '[[:space:]]+', ' ', 'g')
    or lower(right($3, 4)) <> '.pdf'
    or position('/' in $3) > 0
    or position(chr(92) in $3) > 0
    or $3 ~ '[[:cntrl:]]'
    or $3 ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    or $4 is null then
    raise exception using
      errcode = '22023',
      message = 'Safe PDF display metadata is required to finalize the upload.';
  end if;

  canonical_path := details_row.report_storage_owner_id::text || '/' || $1::text
    || '/valuation-report.pdf';

  if not exists (
    select 1
    from storage.objects as stored_object
    where stored_object.bucket_id = 'case-files'
      and stored_object.name = canonical_path
      and stored_object.user_metadata ->> 'uploadId' = $2::text
  ) then
    raise exception using
      errcode = '55000',
      message = 'The canonical report does not match the active upload token.';
  end if;

  update public.total_loss_case_details as details
  set
    intake_mode = 'report',
    report_original_filename = $3,
    report_uploaded_at = $4,
    report_last_upload_id = $2,
    report_upload_id = null,
    report_upload_expires_at = null,
    report_upload_details_updated_at = null,
    report_upload_phase = null,
    report_upload_has_backup = false,
    report_provider_name = null,
    report_extraction_status = 'pending',
    report_extraction_confidence = null,
    report_extracted_at = null,
    report_extraction_source_upload_id = null,
    report_extraction_input_revision = null
  where details.case_id = $1
  returning details.* into details_row;

  update public.appraisal_cases as appraisal_case
  set last_activity_at = statement_timestamp()
  where appraisal_case.id = $1
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss'
    and appraisal_case.status = 'draft';

  if not found then
    raise exception using
      errcode = '55000',
      message = 'The draft case could not be touched after report finalization.';
  end if;

  select
    details_row.case_id,
    details_row.intake_mode,
    details_row.vin,
    details_row.vehicle_year,
    details_row.vehicle_make,
    details_row.vehicle_model,
    details_row.vehicle_trim,
    details_row.mileage_at_loss,
    details_row.postal_code,
    details_row.date_of_loss,
    details_row.insurer_name,
    details_row.insurer_vehicle_valuation,
    details_row.report_original_filename,
    details_row.report_uploaded_at,
    details_row.intake_completed_at,
    details_row.created_at,
    details_row.updated_at
  into public_row;
  return next public_row;
end;
$$;

comment on function public.finalize_total_loss_report_upload(uuid, uuid, text, timestamptz) is
  'Atomically commits token-matched PDF metadata in the immutable report namespace, resets extraction metadata, advances the analysis input revision, and preserves committed-token idempotency.';

create or replace function public.authorize_total_loss_report_storage_write(
  object_name text,
  object_user_metadata jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.total_loss_case_details as details
    join public.appraisal_cases as appraisal_case
      on appraisal_case.id = details.case_id
    where appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'total_loss'
      and appraisal_case.status = 'draft'
      and details.report_upload_id is not null
      and details.report_upload_expires_at > statement_timestamp()
      and details.report_upload_id::text = $2 ->> 'uploadId'
      and (
        (
          $1 = details.report_storage_owner_id::text || '/' || details.case_id::text
            || '/valuation-report.pdf'
          and details.report_upload_phase in ('ready', 'recovering')
        )
        or (
          $1 = details.report_storage_owner_id::text || '/' || details.case_id::text
            || '/valuation-report-backup.pdf'
          and details.report_upload_phase in ('preparing', 'recovering')
        )
      )
  );
$$;

comment on function public.authorize_total_loss_report_storage_write(text, jsonb) is
  'Restricts reserved report objects in the immutable namespace to the current case owner, exact unexpired token, and protocol phase.';

create or replace function public.authorize_total_loss_report_backup_delete(
  object_name text,
  object_user_metadata jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.total_loss_case_details as details
    join public.appraisal_cases as appraisal_case
      on appraisal_case.id = details.case_id
    where appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'total_loss'
      and appraisal_case.status = 'draft'
      and details.report_upload_id is null
      and $1 = details.report_storage_owner_id::text || '/' || details.case_id::text
        || '/valuation-report-backup.pdf'
      and $2 ->> 'uploadId' in (
        details.report_last_upload_id::text,
        details.report_last_cancelled_upload_id::text
      )
  );
$$;

comment on function public.authorize_total_loss_report_backup_delete(text, jsonb) is
  'Permits finalized or cancelled backup cleanup in the immutable namespace only by the current owner while the Total-Loss case remains draft.';

alter table public.total_loss_analysis_jobs
add column source_intake_mode public.total_loss_intake_mode not null default 'report',
add column source_analysis_input_revision bigint not null default 1,
add column source_analysis_input_id uuid;

update public.total_loss_analysis_jobs as analysis_job
set
  source_analysis_input_revision = details.analysis_input_revision,
  source_analysis_input_id = details.analysis_input_id
from public.total_loss_case_details as details
where details.case_id = analysis_job.case_id;

alter table public.total_loss_analysis_jobs
alter column source_report_upload_id drop not null,
drop constraint total_loss_analysis_jobs_case_source_key,
add constraint total_loss_analysis_jobs_source_complete
  check (
    (
      source_intake_mode = 'report'
      and source_report_upload_id is not null
    )
    or (
      source_intake_mode = 'manual'
      and source_report_upload_id is null
    )
  ),
add constraint total_loss_analysis_jobs_source_revision_valid
  check (source_analysis_input_revision >= 1);

create unique index total_loss_analysis_jobs_case_source_key
  on public.total_loss_analysis_jobs (
    case_id,
    source_report_upload_id,
    source_analysis_input_revision
  )
  where source_intake_mode = 'report';

create unique index total_loss_analysis_jobs_manual_source_key
  on public.total_loss_analysis_jobs (
    case_id,
    source_analysis_input_revision
  )
  where source_intake_mode = 'manual';

comment on column public.total_loss_analysis_jobs.source_intake_mode is
  'Whether this immutable analysis source is a finalized report or a customer-confirmed manual input snapshot.';
comment on column public.total_loss_analysis_jobs.source_report_upload_id is
  'Finalized report token for report mode; intentionally NULL for manual analysis.';
comment on column public.total_loss_analysis_jobs.source_analysis_input_revision is
  'Server-owned input revision fenced into every report or manual analysis attempt.';
comment on column public.total_loss_analysis_jobs.source_analysis_input_id is
  'Opaque server-owned input fence. Legacy rows are backfilled; trusted claims always persist the current non-NULL value.';

alter type public.total_loss_analysis_result
add attribute intake_mode public.total_loss_intake_mode,
add attribute source_report_upload_id uuid,
add attribute analysis_input_revision bigint,
add attribute analysis_input_id uuid,
add attribute input_snapshot jsonb,
add attribute storage_bucket text,
add attribute storage_owner_id uuid,
add attribute storage_object_path text,
add attribute report_extraction_available boolean;

comment on type public.total_loss_analysis_result is
  'Trusted coordination projection with a bounded confirmed input snapshot and transfer-safe report locator; manual sources have NULL upload and storage fields.';

create type public.total_loss_report_extraction_result as (
  case_id uuid,
  report_upload_id uuid,
  analysis_input_revision bigint,
  provider_name text,
  extraction_status text,
  confidence numeric(5, 4),
  extraction_schema_version text,
  normalized_report jsonb,
  extracted_at timestamptz,
  updated_at timestamptz
);

revoke all on type public.total_loss_report_extraction_result from public;
revoke all on type public.total_loss_report_extraction_result from anon;
revoke all on type public.total_loss_report_extraction_result from authenticated;
grant usage on type public.total_loss_report_extraction_result to service_role;

create table public.total_loss_report_extractions (
  case_id uuid not null references public.total_loss_case_details (case_id) on delete cascade,
  report_upload_id uuid not null,
  analysis_input_revision bigint not null,
  analysis_input_id uuid not null,
  provider_name text,
  extraction_status text not null,
  confidence numeric(5, 4),
  extraction_schema_version text not null,
  normalized_report jsonb,
  extracted_at timestamptz not null,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (case_id, report_upload_id, analysis_input_revision),
  constraint total_loss_report_extractions_revision_valid
    check (analysis_input_revision >= 1),
  constraint total_loss_report_extractions_provider_safe
    check (
      provider_name is null
      or (
        char_length(btrim(provider_name)) between 1 and 200
        and provider_name !~ '[[:cntrl:]]'
        and provider_name !~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
      )
    ),
  constraint total_loss_report_extractions_status_valid
    check (extraction_status in ('needs_confirmation', 'confirmed', 'failed')),
  constraint total_loss_report_extractions_confidence_valid
    check (confidence is null or confidence between 0 and 1),
  constraint total_loss_report_extractions_schema_version_valid
    check (extraction_schema_version ~ '^[0-9]{1,16}$'),
  constraint total_loss_report_extractions_payload_valid
    check (
      (
        extraction_status = 'failed'
        and normalized_report is null
      )
      or (
        extraction_status in ('needs_confirmation', 'confirmed')
        and jsonb_typeof(normalized_report) = 'object'
        and pg_column_size(normalized_report) <= 1048576
      )
    )
);

comment on table public.total_loss_report_extractions is
  'Private trusted extraction cache fenced to one current finalized report upload and server-owned analysis input revision; browser roles have no table or RPC access.';

alter table public.total_loss_report_extractions enable row level security;

revoke all on table public.total_loss_report_extractions from public;
revoke all on table public.total_loss_report_extractions from anon;
revoke all on table public.total_loss_report_extractions from authenticated;
revoke all on table public.total_loss_report_extractions from service_role;

create function public.persist_total_loss_report_extraction(
  case_id uuid,
  report_upload_id uuid,
  analysis_input_revision bigint,
  provider_name text,
  extraction_status text,
  confidence numeric,
  extraction_schema_version text,
  normalized_report jsonb
)
returns setof public.total_loss_report_extraction_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  details_row public.total_loss_case_details%rowtype;
  extraction_row public.total_loss_report_extractions%rowtype;
  normalized_provider text := nullif(btrim($4), '');
  recorded_at timestamptz := statement_timestamp();
  canonical_path text;
begin
  if $1 is null
    or $2 is null
    or $3 is null
    or $5 is null
    or $7 is null
    or $5 not in ('needs_confirmation', 'confirmed', 'failed')
    or $7 !~ '^[0-9]{1,16}$'
    or $6 is not null and ($6 < 0 or $6 > 1)
    or normalized_provider is not null and (
      char_length(normalized_provider) > 200
      or normalized_provider ~ '[[:cntrl:]]'
      or normalized_provider ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    )
    or (
      $5 = 'failed'
      and $8 is not null
    )
    or (
      $5 in ('needs_confirmation', 'confirmed')
      and (
        coalesce(jsonb_typeof($8), 'missing') <> 'object'
        or pg_column_size($8) > 1048576
      )
    )
  then
    raise exception using
      errcode = '22023',
      message = 'A bounded current report extraction is required.';
  end if;

  select details.*
  into details_row
  from public.total_loss_case_details as details
  join public.appraisal_cases as appraisal_case
    on appraisal_case.id = details.case_id
  where details.case_id = $1
    and appraisal_case.service_type = 'total_loss'
    and details.intake_mode = 'report'
    and details.report_upload_id is null
    and details.report_last_upload_id = $2
    and details.analysis_input_revision = $3
  for update of details;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'The report extraction source is no longer current.';
  end if;

  canonical_path := details_row.report_storage_owner_id::text || '/'
    || details_row.case_id::text || '/valuation-report.pdf';

  if not exists (
    select 1
    from storage.objects as stored_object
    where stored_object.bucket_id = 'case-files'
      and stored_object.name = canonical_path
      and stored_object.user_metadata ->> 'uploadId' = $2::text
  ) then
    raise exception using
      errcode = '55000',
      message = 'The report extraction source is no longer current.';
  end if;

  insert into public.total_loss_report_extractions (
    case_id,
    report_upload_id,
    analysis_input_revision,
    analysis_input_id,
    provider_name,
    extraction_status,
    confidence,
    extraction_schema_version,
    normalized_report,
    extracted_at,
    updated_at
  )
  values (
    $1,
    $2,
    $3,
    details_row.analysis_input_id,
    normalized_provider,
    $5,
    $6,
    $7,
    $8,
    recorded_at,
    recorded_at
  )
  on conflict (case_id, report_upload_id, analysis_input_revision) do update
  set
    analysis_input_id = excluded.analysis_input_id,
    provider_name = excluded.provider_name,
    extraction_status = excluded.extraction_status,
    confidence = excluded.confidence,
    extraction_schema_version = excluded.extraction_schema_version,
    normalized_report = excluded.normalized_report,
    extracted_at = excluded.extracted_at,
    updated_at = excluded.updated_at
  returning * into extraction_row;

  update public.total_loss_case_details as details
  set
    report_provider_name = normalized_provider,
    report_extraction_status = $5,
    report_extraction_confidence = $6,
    report_extracted_at = recorded_at,
    report_extraction_source_upload_id = $2,
    report_extraction_input_revision = $3
  where details.case_id = $1
    and details.report_last_upload_id = $2
    and details.analysis_input_revision = $3;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'The report extraction source is no longer current.';
  end if;

  return query
  select
    extraction_row.case_id,
    extraction_row.report_upload_id,
    extraction_row.analysis_input_revision,
    extraction_row.provider_name,
    extraction_row.extraction_status,
    extraction_row.confidence,
    extraction_row.extraction_schema_version,
    extraction_row.normalized_report,
    extraction_row.extracted_at,
    extraction_row.updated_at;
end;
$$;

comment on function public.persist_total_loss_report_extraction(uuid, uuid, bigint, text, text, numeric, text, jsonb) is
  'Service-role-only upsert of a bounded extraction cache after locking and verifying the exact current finalized upload, input revision, and canonical object.';

create function public.get_total_loss_report_extraction(
  case_id uuid,
  report_upload_id uuid,
  analysis_input_revision bigint
)
returns setof public.total_loss_report_extraction_result
language sql
stable
security definer
set search_path = ''
as $$
  select
    extraction.case_id,
    extraction.report_upload_id,
    extraction.analysis_input_revision,
    extraction.provider_name,
    extraction.extraction_status,
    extraction.confidence,
    extraction.extraction_schema_version,
    extraction.normalized_report,
    extraction.extracted_at,
    extraction.updated_at
  from public.total_loss_report_extractions as extraction
  join public.total_loss_case_details as details
    on details.case_id = extraction.case_id
    and details.report_last_upload_id = extraction.report_upload_id
    and details.analysis_input_revision = extraction.analysis_input_revision
    and details.analysis_input_id = extraction.analysis_input_id
  join public.appraisal_cases as appraisal_case
    on appraisal_case.id = details.case_id
    and appraisal_case.service_type = 'total_loss'
  where extraction.case_id = $1
    and extraction.report_upload_id = $2
    and extraction.analysis_input_revision = $3
    and details.intake_mode = 'report'
    and details.report_upload_id is null;
$$;

comment on function public.get_total_loss_report_extraction(uuid, uuid, bigint) is
  'Returns a cached extraction only while its finalized report token and server-owned input revision remain current.';

revoke execute on function public.persist_total_loss_report_extraction(uuid, uuid, bigint, text, text, numeric, text, jsonb) from public;
revoke execute on function public.persist_total_loss_report_extraction(uuid, uuid, bigint, text, text, numeric, text, jsonb) from anon;
revoke execute on function public.persist_total_loss_report_extraction(uuid, uuid, bigint, text, text, numeric, text, jsonb) from authenticated;
grant execute on function public.persist_total_loss_report_extraction(uuid, uuid, bigint, text, text, numeric, text, jsonb) to service_role;

revoke execute on function public.get_total_loss_report_extraction(uuid, uuid, bigint) from public;
revoke execute on function public.get_total_loss_report_extraction(uuid, uuid, bigint) from anon;
revoke execute on function public.get_total_loss_report_extraction(uuid, uuid, bigint) from authenticated;
grant execute on function public.get_total_loss_report_extraction(uuid, uuid, bigint) to service_role;

create or replace function public.claim_total_loss_analysis(
  case_id uuid,
  user_id uuid,
  processing_token uuid
)
returns setof public.total_loss_analysis_result
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  case_row public.appraisal_cases%rowtype;
  details_row public.total_loss_case_details%rowtype;
  job_row public.total_loss_analysis_jobs%rowtype;
  result_row public.total_loss_analysis_result;
  normalized_postal_code text;
  job_found boolean := false;
begin
  if $1 is null or $2 is null or $3 is null then
    raise exception using
      errcode = '22023',
      message = 'Case, user, and processing identifiers are required.';
  end if;

  select appraisal_case.*
  into case_row
  from public.appraisal_cases as appraisal_case
  where appraisal_case.id = $1
    and appraisal_case.user_id = $2
    and appraisal_case.service_type = 'total_loss'
  for update;

  if not found then
    result_row.outcome := 'not_found';
    return next result_row;
    return;
  end if;

  select details.*
  into details_row
  from public.total_loss_case_details as details
  where details.case_id = $1
  for update;

  if not found then
    result_row.outcome := 'report_intake_required';
    return next result_row;
    return;
  end if;

  normalized_postal_code := nullif(btrim(details_row.postal_code), '');
  result_row.postal_code := normalized_postal_code;
  result_row.intake_mode := details_row.intake_mode;
  result_row.source_report_upload_id := case
    when details_row.intake_mode = 'report'
      then details_row.report_last_upload_id
    else null
  end;
  result_row.analysis_input_revision := details_row.analysis_input_revision;
  result_row.analysis_input_id := details_row.analysis_input_id;
  result_row.input_snapshot :=
    public.build_total_loss_analysis_input_snapshot(details_row);

  if details_row.intake_mode = 'report' then
    result_row.storage_bucket := 'case-files';
    result_row.storage_owner_id := details_row.report_storage_owner_id;
    result_row.storage_object_path :=
      details_row.report_storage_owner_id::text || '/' || details_row.case_id::text
      || '/valuation-report.pdf';
    result_row.report_extraction_available := exists (
      select 1
      from public.total_loss_report_extractions as extraction
      where extraction.case_id = details_row.case_id
        and extraction.report_upload_id = details_row.report_last_upload_id
        and extraction.analysis_input_revision =
          details_row.analysis_input_revision
        and extraction.analysis_input_id = details_row.analysis_input_id
        and extraction.extraction_status = 'confirmed'
    );
  else
    result_row.report_extraction_available := false;
  end if;

  if details_row.intake_mode = 'report'
    and details_row.report_last_upload_id is not null then
    select analysis_job.*
    into job_row
    from public.total_loss_analysis_jobs as analysis_job
    where analysis_job.case_id = $1
      and analysis_job.source_intake_mode = 'report'
      and analysis_job.source_report_upload_id = details_row.report_last_upload_id
      and analysis_job.source_analysis_input_revision =
        details_row.analysis_input_revision
      and analysis_job.source_analysis_input_id = details_row.analysis_input_id
    for update;
    job_found := found;
  elsif details_row.intake_mode = 'manual' then
    select analysis_job.*
    into job_row
    from public.total_loss_analysis_jobs as analysis_job
    where analysis_job.case_id = $1
      and analysis_job.source_intake_mode = 'manual'
      and analysis_job.source_report_upload_id is null
      and analysis_job.source_analysis_input_revision =
        details_row.analysis_input_revision
      and analysis_job.source_analysis_input_id = details_row.analysis_input_id
    for update;
    job_found := found;
  end if;

  if job_found and job_row.status = 'completed' then
    result_row.outcome := 'completed';
    result_row.job_id := job_row.id;
    result_row.status := job_row.status;
    result_row.attempt_count := job_row.attempt_count;
    result_row.run_id := job_row.run_id;
    result_row.failure_code := job_row.failure_code;
    result_row.retryable := job_row.retryable;
    result_row.processing_expires_at := job_row.processing_expires_at;
    return next result_row;
    return;
  end if;

  if job_found and job_row.status = 'processing'
    and job_row.processing_expires_at > statement_timestamp() then
    if case_row.status <> 'checking' then
      result_row.outcome := 'case_not_ready';
      return next result_row;
      return;
    end if;

    result_row.outcome := case
      when job_row.processing_token = $3
        then 'claimed'::public.total_loss_analysis_outcome
      else 'processing'::public.total_loss_analysis_outcome
    end;
    result_row.job_id := job_row.id;
    result_row.status := job_row.status;
    result_row.attempt_count := job_row.attempt_count;
    result_row.run_id := job_row.run_id;
    result_row.failure_code := job_row.failure_code;
    result_row.retryable := job_row.retryable;
    result_row.processing_expires_at := job_row.processing_expires_at;
    return next result_row;
    return;
  end if;

  if job_found and job_row.status = 'failed' and not job_row.retryable then
    result_row.outcome := 'failed';
    result_row.job_id := job_row.id;
    result_row.status := job_row.status;
    result_row.attempt_count := job_row.attempt_count;
    result_row.run_id := job_row.run_id;
    result_row.failure_code := job_row.failure_code;
    result_row.retryable := job_row.retryable;
    result_row.processing_expires_at := job_row.processing_expires_at;
    return next result_row;
    return;
  end if;

  if details_row.intake_completed_at is null then
    result_row.outcome := 'intake_not_ready';
    return next result_row;
    return;
  end if;

  if normalized_postal_code is null then
    result_row.outcome := 'postal_code_required';
    return next result_row;
    return;
  end if;

  if normalized_postal_code !~ '^[0-9]{5}(-[0-9]{4})?$' then
    result_row.outcome := 'invalid_postal_code';
    return next result_row;
    return;
  end if;

  if details_row.intake_mode = 'manual'
    and not public.total_loss_manual_input_is_complete(details_row) then
    result_row.outcome := 'intake_not_ready';
    return next result_row;
    return;
  end if;

  if details_row.intake_mode = 'report' then
    if details_row.report_upload_id is not null
      or details_row.report_last_upload_id is null
      or details_row.report_original_filename is null
      or details_row.report_uploaded_at is null then
      result_row.outcome := 'report_required';
      return next result_row;
      return;
    end if;

    if not exists (
      select 1
      from storage.objects as stored_object
      where stored_object.bucket_id = 'case-files'
        and stored_object.name = result_row.storage_object_path
        and stored_object.user_metadata ->> 'uploadId'
          = details_row.report_last_upload_id::text
    ) then
      result_row.outcome := 'report_required';
      return next result_row;
      return;
    end if;
  end if;

  if (
    not job_found
    and case_row.status <> 'draft'
  ) or (
    job_found
    and job_row.status = 'processing'
    and case_row.status <> 'checking'
  ) or (
    job_found
    and job_row.status = 'failed'
    and case_row.status <> 'draft'
  ) then
    result_row.outcome := 'case_not_ready';
    return next result_row;
    return;
  end if;

  if job_found then
    update public.total_loss_analysis_jobs as analysis_job
    set
      source_details_updated_at = details_row.updated_at,
      source_intake_mode = details_row.intake_mode,
      source_report_upload_id = case
        when details_row.intake_mode = 'report'
          then details_row.report_last_upload_id
        else null
      end,
      source_analysis_input_revision = details_row.analysis_input_revision,
      source_analysis_input_id = details_row.analysis_input_id,
      status = 'processing',
      attempt_count = analysis_job.attempt_count + 1,
      processing_token = $3,
      processing_expires_at = statement_timestamp() + interval '2 hours',
      failure_code = null,
      retryable = null,
      finished_at = null
    where analysis_job.id = job_row.id
    returning analysis_job.* into job_row;
  else
    insert into public.total_loss_analysis_jobs (
      case_id,
      source_report_upload_id,
      source_details_updated_at,
      source_intake_mode,
      source_analysis_input_revision,
      source_analysis_input_id,
      processing_token,
      processing_expires_at
    )
    values (
      $1,
      case
        when details_row.intake_mode = 'report'
          then details_row.report_last_upload_id
        else null
      end,
      details_row.updated_at,
      details_row.intake_mode,
      details_row.analysis_input_revision,
      details_row.analysis_input_id,
      $3,
      statement_timestamp() + interval '2 hours'
    )
    returning * into job_row;
  end if;

  update public.appraisal_cases as appraisal_case
  set
    status = 'checking',
    last_activity_at = statement_timestamp()
  where appraisal_case.id = case_row.id;

  result_row.outcome := 'claimed';
  result_row.job_id := job_row.id;
  result_row.status := job_row.status;
  result_row.attempt_count := job_row.attempt_count;
  result_row.run_id := job_row.run_id;
  result_row.failure_code := job_row.failure_code;
  result_row.retryable := job_row.retryable;
  result_row.processing_expires_at := job_row.processing_expires_at;
  return next result_row;
end;
$$;

comment on function public.claim_total_loss_analysis(uuid, uuid, uuid) is
  'Claims report or complete manual Total-Loss analysis using a bounded confirmed input snapshot, stable report locator, source-mode idempotency, input-revision fencing, and the existing worker lease protocol.';

create or replace function public.get_total_loss_analysis_status(
  case_id uuid,
  user_id uuid
)
returns setof public.total_loss_analysis_result
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  details_row public.total_loss_case_details%rowtype;
  job_row public.total_loss_analysis_jobs%rowtype;
  result_row public.total_loss_analysis_result;
begin
  if $1 is null or $2 is null or not exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = $1
      and appraisal_case.user_id = $2
      and appraisal_case.service_type = 'total_loss'
  ) then
    result_row.outcome := 'not_found';
    return next result_row;
    return;
  end if;

  select details.*
  into details_row
  from public.total_loss_case_details as details
  where details.case_id = $1;

  if not found then
    result_row.outcome := 'not_submitted';
    return next result_row;
    return;
  end if;

  result_row.postal_code := nullif(btrim(details_row.postal_code), '');
  result_row.intake_mode := details_row.intake_mode;
  result_row.source_report_upload_id := case
    when details_row.intake_mode = 'report'
      then details_row.report_last_upload_id
    else null
  end;
  result_row.analysis_input_revision := details_row.analysis_input_revision;
  result_row.analysis_input_id := details_row.analysis_input_id;
  result_row.input_snapshot :=
    public.build_total_loss_analysis_input_snapshot(details_row);

  if details_row.intake_mode = 'report' then
    result_row.storage_bucket := 'case-files';
    result_row.storage_owner_id := details_row.report_storage_owner_id;
    result_row.storage_object_path :=
      details_row.report_storage_owner_id::text || '/' || details_row.case_id::text
      || '/valuation-report.pdf';
    result_row.report_extraction_available := exists (
      select 1
      from public.total_loss_report_extractions as extraction
      where extraction.case_id = details_row.case_id
        and extraction.report_upload_id = details_row.report_last_upload_id
        and extraction.analysis_input_revision =
          details_row.analysis_input_revision
        and extraction.analysis_input_id = details_row.analysis_input_id
        and extraction.extraction_status = 'confirmed'
    );

    if details_row.report_last_upload_id is null then
      result_row.outcome := 'not_submitted';
      return next result_row;
      return;
    end if;

    select analysis_job.*
    into job_row
    from public.total_loss_analysis_jobs as analysis_job
    where analysis_job.case_id = $1
      and analysis_job.source_intake_mode = 'report'
      and analysis_job.source_report_upload_id = details_row.report_last_upload_id
      and analysis_job.source_analysis_input_revision =
        details_row.analysis_input_revision
      and analysis_job.source_analysis_input_id = details_row.analysis_input_id;
  else
    result_row.report_extraction_available := false;

    select analysis_job.*
    into job_row
    from public.total_loss_analysis_jobs as analysis_job
    where analysis_job.case_id = $1
      and analysis_job.source_intake_mode = 'manual'
      and analysis_job.source_report_upload_id is null
      and analysis_job.source_analysis_input_revision =
        details_row.analysis_input_revision
      and analysis_job.source_analysis_input_id = details_row.analysis_input_id;
  end if;

  if not found then
    result_row.outcome := 'not_submitted';
    return next result_row;
    return;
  end if;

  result_row.outcome := job_row.status::text::public.total_loss_analysis_outcome;
  result_row.job_id := job_row.id;
  result_row.status := job_row.status;
  result_row.attempt_count := job_row.attempt_count;
  result_row.run_id := job_row.run_id;
  result_row.failure_code := job_row.failure_code;
  result_row.retryable := job_row.retryable;
  result_row.processing_expires_at := job_row.processing_expires_at;
  return next result_row;
end;
$$;

comment on function public.get_total_loss_analysis_status(uuid, uuid) is
  'Returns bounded current-source status for either report or manual intake after explicit trusted owner verification.';

create or replace view public.total_loss_case_operations_internal
with (security_invoker = true)
as
select
  appraisal_case.id as case_id,
  appraisal_case.user_id as owner_user_id,
  coalesce(
    case
      when profile.full_name_confirmed_at is not null
        then profile.display_name
      else null
    end,
    contact.full_name
  ) as customer_full_name,
  case
    when auth_user.email_confirmed_at is not null
      then auth_user.email
    else null
  end as verified_email,
  coalesce(
    contact.operational_follow_up_allowed,
    profile.operational_follow_up_allowed
  ) as operational_follow_up_allowed,
  appraisal_case.service_type,
  appraisal_case.status as case_status,
  case
    when appraisal_case.status = 'closed'
      then 'closed'::public.case_operation_stage
    when details.report_upload_id is not null
      and details.report_upload_expires_at <= statement_timestamp()
      then 'needs_attention'::public.case_operation_stage
    when analysis_job.status = 'completed'
      and analysis_run.id is not null
      and appraisal_case.status in ('check_complete', 'completed')
      then 'analysis_complete'::public.case_operation_stage
    when analysis_job.status = 'completed'
      then 'needs_attention'::public.case_operation_stage
    when analysis_job.status = 'processing'
      and appraisal_case.status = 'checking'
      and analysis_job.processing_expires_at > statement_timestamp()
      then 'analysis_processing'::public.case_operation_stage
    when analysis_job.status = 'processing'
      then 'needs_attention'::public.case_operation_stage
    when analysis_job.status = 'failed'
      and appraisal_case.status = 'draft'
      then 'analysis_failed'::public.case_operation_stage
    when analysis_job.status = 'failed'
      then 'needs_attention'::public.case_operation_stage
    when appraisal_case.status <> 'draft'
      then 'needs_attention'::public.case_operation_stage
    when details.case_id is null
      then 'intake_not_started'::public.case_operation_stage
    when details.intake_mode = 'report'
      and num_nonnulls(
        details.report_last_upload_id,
        details.report_original_filename,
        details.report_uploaded_at
      ) not in (0, 3)
      then 'needs_attention'::public.case_operation_stage
    when details.intake_mode = 'report'
      and details.report_last_upload_id is not null
      and details.report_upload_id is null
      and canonical_report.id is null
      then 'needs_attention'::public.case_operation_stage
    when details.intake_mode = 'manual'
      and public.total_loss_manual_input_is_complete(details)
      then 'ready_for_analysis'::public.case_operation_stage
    when details.intake_mode = 'manual'
      and details.intake_completed_at is not null
      then 'needs_attention'::public.case_operation_stage
    when details.intake_mode = 'report'
      and details.intake_completed_at is not null
      and details.report_upload_id is not null
      and details.report_last_upload_id is not null
      then 'report_uploaded'::public.case_operation_stage
    when details.intake_mode = 'report'
      and details.intake_completed_at is not null
      and details.report_upload_id is null
      and canonical_report.id is not null
      then 'ready_for_analysis'::public.case_operation_stage
    when details.intake_mode = 'report'
      and details.intake_completed_at is not null
      then 'report_required'::public.case_operation_stage
    when details.intake_mode = 'report'
      and canonical_report.id is not null
      then 'report_uploaded'::public.case_operation_stage
    else 'intake_in_progress'::public.case_operation_stage
  end as case_stage,
  appraisal_case.created_at as case_created_at,
  appraisal_case.updated_at as case_updated_at,
  appraisal_case.last_activity_at,
  details.intake_mode,
  details.vin,
  details.vehicle_year,
  details.vehicle_make,
  details.vehicle_model,
  details.vehicle_trim,
  details.mileage_at_loss,
  details.postal_code,
  details.date_of_loss,
  details.insurer_name,
  details.insurer_vehicle_valuation,
  details.intake_completed_at,
  details.created_at as details_created_at,
  details.updated_at as details_updated_at,
  details.report_original_filename,
  details.report_uploaded_at,
  details.report_last_upload_id,
  details.report_upload_id,
  details.report_upload_expires_at,
  canonical_report.id is not null as canonical_report_available,
  analysis_job.id as analysis_job_id,
  analysis_job.status as analysis_status,
  analysis_job.attempt_count as analysis_attempt_count,
  analysis_job.failure_code as analysis_failure_code,
  analysis_job.retryable as analysis_retryable,
  analysis_job.processing_expires_at as analysis_processing_expires_at,
  analysis_job.created_at as analysis_job_created_at,
  analysis_job.updated_at as analysis_job_updated_at,
  analysis_job.finished_at as analysis_job_finished_at,
  analysis_run.id as analysis_run_id,
  analysis_run.created_at as analysis_run_created_at,
  analysis_run.analysis_run_schema_version,
  analysis_run.analysis_version,
  analysis_run.discrepancy_analysis_version,
  analysis_run.comparable_scoring_version,
  analysis_run.artifact #>>
    '{result,discrepancyResult,classification}' as analysis_classification,
  analysis_run.artifact #>>
    '{result,discrepancyResult,evidenceStrength}' as analysis_evidence_strength,
  analysis_run.artifact #>>
    '{result,discrepancyResult,evidenceBasis}' as analysis_evidence_basis,
  coalesce(auth_user.is_anonymous, false) as owner_is_anonymous,
  contact.full_name as contact_full_name,
  contact.email as contact_email,
  contact.email_verified_at,
  contact.email_verified_at is not null as contact_email_verified,
  identity_state.claimed_at as identity_claimed_at,
  details.vehicle_condition,
  details.vehicle_options_packages,
  details.report_provider_name,
  details.report_extraction_status,
  details.report_extraction_confidence,
  details.report_extracted_at,
  details.report_facts_confirmed_at,
  details.analysis_input_revision,
  details.analysis_input_id,
  details.report_storage_owner_id,
  case
    when details.case_id is not null then
      details.report_storage_owner_id::text || '/' || details.case_id::text
        || '/valuation-report.pdf'
    else null
  end as report_storage_object_path
from public.appraisal_cases as appraisal_case
join auth.users as auth_user
  on auth_user.id = appraisal_case.user_id
left join public.profiles as profile
  on profile.id = appraisal_case.user_id
left join public.total_loss_case_details as details
  on details.case_id = appraisal_case.id
left join public.total_loss_case_contacts as contact
  on contact.case_id = appraisal_case.id
left join lateral (
  select max(identity_claim.claimed_at) as claimed_at
  from public.total_loss_case_identity_claims as identity_claim
  where identity_claim.case_id = appraisal_case.id
    and identity_claim.claimed_by_user_id = appraisal_case.user_id
) as identity_state on true
left join storage.objects as canonical_report
  on canonical_report.bucket_id = 'case-files'
  and canonical_report.name = details.report_storage_owner_id::text || '/'
    || appraisal_case.id::text || '/valuation-report.pdf'
  and canonical_report.user_metadata ->> 'uploadId'
    = details.report_last_upload_id::text
left join public.total_loss_analysis_jobs as analysis_job
  on analysis_job.case_id = appraisal_case.id
  and analysis_job.source_intake_mode = details.intake_mode
  and analysis_job.source_analysis_input_revision =
    details.analysis_input_revision
  and (
    analysis_job.source_analysis_input_id = details.analysis_input_id
    or analysis_job.source_analysis_input_id is null
  )
  and (
    (
      details.intake_mode = 'report'
      and analysis_job.source_report_upload_id = details.report_last_upload_id
    )
    or (
      details.intake_mode = 'manual'
      and analysis_job.source_report_upload_id is null
    )
  )
left join public.analysis_runs as analysis_run
  on analysis_run.id = analysis_job.run_id
  and analysis_run.job_id = analysis_job.id
  and analysis_run.case_id = analysis_job.case_id
where appraisal_case.service_type = 'total_loss';

comment on view public.total_loss_case_operations_internal is
  'Unprivileged current-input-aware Total-Loss projection supporting report and manual analysis, immutable report locators, and bounded guest/contact identity facts. Browser access remains owner- or staff-gated through RPCs.';

revoke all on table public.total_loss_case_operations_internal from public;
revoke all on table public.total_loss_case_operations_internal from anon;
revoke all on table public.total_loss_case_operations_internal from authenticated;
revoke all on table public.total_loss_case_operations_internal from service_role;

drop function public.staff_list_case_operations();

create function public.staff_list_case_operations()
returns table (
  case_id uuid,
  owner_user_id uuid,
  customer_full_name text,
  verified_email text,
  owner_is_anonymous boolean,
  contact_full_name text,
  contact_email text,
  contact_email_verified boolean,
  identity_claimed_at timestamptz,
  service_type public.appraisal_service_type,
  case_status public.appraisal_case_status,
  case_stage public.case_operation_stage,
  needs_attention boolean,
  case_created_at timestamptz,
  case_updated_at timestamptz,
  last_activity_at timestamptz,
  report_uploaded_at timestamptz,
  analysis_status public.total_loss_analysis_status,
  analysis_attempt_count integer,
  analysis_retryable boolean,
  analysis_failure_code text,
  analysis_processing_expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    operation.case_id,
    operation.owner_user_id,
    operation.customer_full_name,
    operation.verified_email,
    operation.owner_is_anonymous,
    operation.contact_full_name,
    operation.contact_email,
    operation.contact_email_verified,
    operation.identity_claimed_at,
    operation.service_type,
    operation.case_status,
    operation.case_stage,
    operation.case_stage in (
      'analysis_failed'::public.case_operation_stage,
      'needs_attention'::public.case_operation_stage
    ) or (
      operation.report_upload_id is not null
      and operation.report_upload_expires_at <= statement_timestamp()
    ) or (
      operation.intake_mode = 'report'
      and operation.report_last_upload_id is not null
      and operation.report_upload_id is null
      and not operation.canonical_report_available
    ) as needs_attention,
    operation.case_created_at,
    operation.case_updated_at,
    operation.last_activity_at,
    operation.report_uploaded_at,
    operation.analysis_status,
    operation.analysis_attempt_count,
    operation.analysis_retryable,
    operation.analysis_failure_code,
    operation.analysis_processing_expires_at
  from public.total_loss_case_operations_internal as operation
  where (select public.is_venfour_staff())

  union all

  select
    appraisal_case.id,
    appraisal_case.user_id,
    coalesce(
      case
        when profile.full_name_confirmed_at is not null
          then profile.display_name
        else null
      end,
      nullif(btrim(details.full_name), '')
    ),
    case
      when auth_user.email_confirmed_at is not null
        then auth_user.email
      else null
    end,
    coalesce(auth_user.is_anonymous, false),
    null::text,
    null::text,
    false,
    null::timestamptz,
    appraisal_case.service_type,
    appraisal_case.status,
    'submitted'::public.case_operation_stage,
    false,
    appraisal_case.created_at,
    appraisal_case.updated_at,
    appraisal_case.last_activity_at,
    null::timestamptz,
    null::public.total_loss_analysis_status,
    null::integer,
    null::boolean,
    null::text,
    null::timestamptz
  from public.appraisal_cases as appraisal_case
  join public.diminished_value_case_details as details
    on details.case_id = appraisal_case.id
    and details.submitted_at is not null
  join auth.users as auth_user
    on auth_user.id = appraisal_case.user_id
  left join public.profiles as profile
    on profile.id = appraisal_case.user_id
  where (select public.is_venfour_staff())
    and appraisal_case.service_type = 'diminished_value'
    and appraisal_case.status = 'submitted'

  order by last_activity_at desc, case_id desc;
$$;

comment on function public.staff_list_case_operations() is
  'Returns staff-authorized Total-Loss and submitted Diminished Value operations with explicit guest, entered-contact, verified-email, and claimed-identity states; staff_members remains the only authorization authority.';

revoke execute on function public.staff_list_case_operations() from public;
revoke execute on function public.staff_list_case_operations() from anon;
grant execute on function public.staff_list_case_operations() to authenticated;
revoke execute on function public.staff_list_case_operations() from service_role;

drop function public.staff_get_total_loss_case_operation(uuid);

create function public.staff_get_total_loss_case_operation(
  requested_case_id uuid
)
returns table (
  case_id uuid,
  owner_user_id uuid,
  customer_full_name text,
  verified_email text,
  owner_is_anonymous boolean,
  contact_full_name text,
  contact_email text,
  contact_email_verified boolean,
  identity_claimed_at timestamptz,
  operational_follow_up_allowed boolean,
  service_type public.appraisal_service_type,
  case_status public.appraisal_case_status,
  case_stage public.case_operation_stage,
  needs_attention boolean,
  case_created_at timestamptz,
  case_updated_at timestamptz,
  last_activity_at timestamptz,
  intake_mode public.total_loss_intake_mode,
  vin text,
  vehicle_year smallint,
  vehicle_make text,
  vehicle_model text,
  vehicle_trim text,
  mileage_at_loss integer,
  postal_code text,
  date_of_loss date,
  insurer_name text,
  insurer_vehicle_valuation numeric(12, 2),
  vehicle_condition text,
  vehicle_options_packages text,
  report_provider_name text,
  report_extraction_status text,
  report_extraction_confidence numeric(5, 4),
  report_extracted_at timestamptz,
  report_facts_confirmed_at timestamptz,
  analysis_input_revision bigint,
  analysis_input_id uuid,
  intake_completed_at timestamptz,
  details_created_at timestamptz,
  details_updated_at timestamptz,
  report_original_filename text,
  report_uploaded_at timestamptz,
  report_storage_owner_id uuid,
  report_storage_object_path text,
  analysis_job_id uuid,
  analysis_status public.total_loss_analysis_status,
  analysis_attempt_count integer,
  analysis_failure_code text,
  analysis_retryable boolean,
  analysis_processing_expires_at timestamptz,
  analysis_job_created_at timestamptz,
  analysis_job_updated_at timestamptz,
  analysis_job_finished_at timestamptz,
  analysis_run_id uuid,
  analysis_run_created_at timestamptz,
  analysis_run_schema_version text,
  analysis_version text,
  discrepancy_analysis_version text,
  comparable_scoring_version text,
  analysis_classification text,
  analysis_evidence_strength text,
  analysis_evidence_basis text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    operation.case_id,
    operation.owner_user_id,
    operation.customer_full_name,
    operation.verified_email,
    operation.owner_is_anonymous,
    operation.contact_full_name,
    operation.contact_email,
    operation.contact_email_verified,
    operation.identity_claimed_at,
    operation.operational_follow_up_allowed,
    operation.service_type,
    operation.case_status,
    operation.case_stage,
    operation.case_stage in (
      'analysis_failed'::public.case_operation_stage,
      'needs_attention'::public.case_operation_stage
    ) or (
      operation.report_upload_id is not null
      and operation.report_upload_expires_at <= statement_timestamp()
    ) or (
      operation.intake_mode = 'report'
      and operation.report_last_upload_id is not null
      and operation.report_upload_id is null
      and not operation.canonical_report_available
    ) as needs_attention,
    operation.case_created_at,
    operation.case_updated_at,
    operation.last_activity_at,
    operation.intake_mode,
    operation.vin,
    operation.vehicle_year,
    operation.vehicle_make,
    operation.vehicle_model,
    operation.vehicle_trim,
    operation.mileage_at_loss,
    operation.postal_code,
    operation.date_of_loss,
    operation.insurer_name,
    operation.insurer_vehicle_valuation,
    operation.vehicle_condition,
    operation.vehicle_options_packages,
    operation.report_provider_name,
    operation.report_extraction_status,
    operation.report_extraction_confidence,
    operation.report_extracted_at,
    operation.report_facts_confirmed_at,
    operation.analysis_input_revision,
    operation.analysis_input_id,
    operation.intake_completed_at,
    operation.details_created_at,
    operation.details_updated_at,
    operation.report_original_filename,
    operation.report_uploaded_at,
    operation.report_storage_owner_id,
    operation.report_storage_object_path,
    operation.analysis_job_id,
    operation.analysis_status,
    operation.analysis_attempt_count,
    operation.analysis_failure_code,
    operation.analysis_retryable,
    operation.analysis_processing_expires_at,
    operation.analysis_job_created_at,
    operation.analysis_job_updated_at,
    operation.analysis_job_finished_at,
    operation.analysis_run_id,
    operation.analysis_run_created_at,
    operation.analysis_run_schema_version,
    operation.analysis_version,
    operation.discrepancy_analysis_version,
    operation.comparable_scoring_version,
    operation.analysis_classification,
    operation.analysis_evidence_strength,
    operation.analysis_evidence_basis
  from public.total_loss_case_operations_internal as operation
  where (select public.is_venfour_staff())
    and operation.case_id = $1;
$$;

comment on function public.staff_get_total_loss_case_operation(uuid) is
  'Returns one staff-authorized bounded Total-Loss operation with guest/contact/claim state, provider-neutral confirmed inputs, and transfer-safe report locator.';

revoke execute on function public.staff_get_total_loss_case_operation(uuid) from public;
revoke execute on function public.staff_get_total_loss_case_operation(uuid) from anon;
grant execute on function public.staff_get_total_loss_case_operation(uuid) to authenticated;
revoke execute on function public.staff_get_total_loss_case_operation(uuid) from service_role;

create function public.authorize_total_loss_storage_namespace(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.total_loss_case_details as details
    join public.appraisal_cases as appraisal_case
      on appraisal_case.id = details.case_id
    where appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'total_loss'
      and cardinality(storage.foldername($1)) >= 2
      and (storage.foldername($1))[1] = details.report_storage_owner_id::text
      and lower((storage.foldername($1))[2]) = details.case_id::text
  );
$$;

comment on function public.authorize_total_loss_storage_namespace(text) is
  'Authorizes only the current Total-Loss case owner below the immutable report namespace, even when that namespace records a prior anonymous owner.';

revoke execute on function public.authorize_total_loss_storage_namespace(text) from public;
revoke execute on function public.authorize_total_loss_storage_namespace(text) from anon;
grant execute on function public.authorize_total_loss_storage_namespace(text) to authenticated;
revoke execute on function public.authorize_total_loss_storage_namespace(text) from service_role;

drop policy if exists "Customers can read files for their own cases"
on storage.objects;
drop policy if exists "Customers can add files for their own cases"
on storage.objects;
drop policy if exists "Customers can update files for their own cases"
on storage.objects;
drop policy if exists "Customers can delete files for their own cases"
on storage.objects;

create policy "Customers can read files for their own cases"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'case-files'
  and (
    public.authorize_total_loss_storage_namespace(name)
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and exists (
        select 1
        from public.appraisal_cases as appraisal_case
        where appraisal_case.id::text = lower((storage.foldername(name))[2])
          and appraisal_case.user_id = (select auth.uid())
          and appraisal_case.service_type = 'diminished_value'
      )
    )
  )
);

comment on policy "Customers can read files for their own cases"
on storage.objects is
  'Current Total-Loss owners read the immutable namespace after transfer; Diminished Value preserves its existing owned user/case namespace.';

create policy "Customers can add files for their own cases"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'case-files'
  and (
    (
      public.authorize_total_loss_storage_namespace(name)
      and (
        not (
          cardinality(storage.foldername(name)) = 2
          and storage.filename(name) in (
            'valuation-report.pdf',
            'valuation-report-backup.pdf'
          )
        )
        or public.authorize_total_loss_report_storage_write(name, user_metadata)
      )
    )
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and public.authorize_diminished_value_document_mutation(name)
      and jsonb_typeof(user_metadata) = 'object'
      and char_length(user_metadata ->> 'originalName') between 1 and 255
      and user_metadata ->> 'originalName' = regexp_replace(
        btrim(user_metadata ->> 'originalName'),
        '[[:space:]]+',
        ' ',
        'g'
      )
      and user_metadata ->> 'originalName' ~* '\.(pdf|jpe?g|png|heic|heif)$'
      and (
        (
          storage.filename(name) ~ '\.pdf$'
          and user_metadata ->> 'originalName' ~* '\.pdf$'
        )
        or (
          storage.filename(name) ~ '\.jpg$'
          and user_metadata ->> 'originalName' ~* '\.jpe?g$'
        )
        or (
          storage.filename(name) ~ '\.png$'
          and user_metadata ->> 'originalName' ~* '\.png$'
        )
        or (
          storage.filename(name) ~ '\.heic$'
          and user_metadata ->> 'originalName' ~* '\.heic$'
        )
        or (
          storage.filename(name) ~ '\.heif$'
          and user_metadata ->> 'originalName' ~* '\.heif$'
        )
      )
      and position('/' in user_metadata ->> 'originalName') = 0
      and position(chr(92) in user_metadata ->> 'originalName') = 0
      and user_metadata ->> 'originalName' !~ '[[:cntrl:]]'
      and user_metadata ->> 'originalName' !~
        U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    )
  )
);

comment on policy "Customers can add files for their own cases"
on storage.objects is
  'Total-Loss inserts use the immutable current-owner namespace and existing token-fenced reserved PDF protocol; Diminished Value retains exact draft-path and safe-metadata rules.';

create policy "Customers can update files for their own cases"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'case-files'
  and public.authorize_total_loss_storage_namespace(name)
  and (
    not (
      cardinality(storage.foldername(name)) = 2
      and storage.filename(name) in (
        'valuation-report.pdf',
        'valuation-report-backup.pdf'
      )
    )
    or storage.allow_only_operation('storage.object.upload_update')
  )
)
with check (
  bucket_id = 'case-files'
  and public.authorize_total_loss_storage_namespace(name)
  and (
    not (
      cardinality(storage.foldername(name)) = 2
      and storage.filename(name) in (
        'valuation-report.pdf',
        'valuation-report-backup.pdf'
      )
    )
    or (
      storage.allow_only_operation('storage.object.upload_update')
      and public.authorize_total_loss_report_storage_write(name, user_metadata)
    )
  )
);

comment on policy "Customers can update files for their own cases"
on storage.objects is
  'Current Total-Loss ownership is checked on both old and resulting immutable paths; reserved PDFs retain upload-operation and token fencing, and Diminished Value updates remain denied.';

create policy "Customers can delete files for their own cases"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'case-files'
  and (
    (
      public.authorize_total_loss_storage_namespace(name)
      and (
        not (
          cardinality(storage.foldername(name)) = 2
          and storage.filename(name) in (
            'valuation-report.pdf',
            'valuation-report-backup.pdf'
          )
        )
        or (
          cardinality(storage.foldername(name)) = 2
          and storage.filename(name) = 'valuation-report-backup.pdf'
          and public.authorize_total_loss_report_backup_delete(
            name,
            user_metadata
          )
        )
      )
    )
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and public.authorize_diminished_value_document_mutation(name)
    )
  )
);

comment on policy "Customers can delete files for their own cases"
on storage.objects is
  'Current Total-Loss owners retain existing backup-only reserved deletion in the immutable namespace; exact owned Diminished Value documents remain deletable only before submission.';
