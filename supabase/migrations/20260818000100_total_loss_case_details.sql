create type public.total_loss_intake_mode as enum (
  'report',
  'manual'
);

comment on type public.total_loss_intake_mode is
  'How a customer supplies the initial evidence for a total-loss appraisal case.';

create table public.total_loss_case_details (
  case_id uuid primary key references public.appraisal_cases (id) on delete cascade,
  intake_mode public.total_loss_intake_mode not null,
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
  report_original_filename text,
  report_uploaded_at timestamptz,
  report_upload_id uuid,
  report_upload_expires_at timestamptz,
  report_upload_details_updated_at timestamptz,
  report_upload_phase text,
  report_upload_has_backup boolean not null default false,
  report_last_upload_id uuid,
  report_last_cancelled_upload_id uuid,
  intake_completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_case_details_mileage_nonnegative
    check (mileage_at_loss is null or mileage_at_loss >= 0),
  constraint total_loss_case_details_valuation_positive
    check (
      insurer_vehicle_valuation is null
      or insurer_vehicle_valuation > 0
    ),
  constraint total_loss_case_details_report_filename_safe
    check (
      report_original_filename is null
      or (
        char_length(report_original_filename) between 1 and 255
        and report_original_filename = regexp_replace(
          btrim(report_original_filename),
          '[[:space:]]+',
          ' ',
          'g'
        )
        and lower(right(report_original_filename, 4)) = '.pdf'
        and position('/' in report_original_filename) = 0
        and position(chr(92) in report_original_filename) = 0
        and report_original_filename !~ '[[:cntrl:]]'
        and report_original_filename !~
          U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
      )
    ),
  constraint total_loss_case_details_report_upload_lease_complete
    check (
      (
        report_upload_id is null
        and report_upload_expires_at is null
        and report_upload_details_updated_at is null
        and report_upload_phase is null
        and not report_upload_has_backup
      )
      or (
        report_upload_id is not null
        and report_upload_expires_at is not null
        and report_upload_details_updated_at is not null
        and report_upload_phase in ('preparing', 'ready', 'recovering')
        and (
          report_upload_phase <> 'recovering'
          or report_upload_has_backup
        )
      )
    )
);

comment on table public.total_loss_case_details is
  'One-to-one, customer-entered intake data for a total-loss appraisal case. The parent case remains authoritative for ownership, service type, status, and activity.';
comment on column public.total_loss_case_details.case_id is
  'The parent appraisal case identifier. It is immutable to browser clients and is not an analysis run identifier.';
comment on column public.total_loss_case_details.intake_completed_at is
  'Marks successful intake persistence without advancing the server-controlled parent case status.';
comment on column public.total_loss_case_details.report_original_filename is
  'A sanitized display filename only; storage uses a deterministic server-independent object path.';
comment on column public.total_loss_case_details.report_upload_id is
  'Internal unguessable token for the active report-upload lease. Browser clients receive it only from lease RPCs.';
comment on column public.total_loss_case_details.report_upload_details_updated_at is
  'Internal optimistic-concurrency version captured when the active report upload begins.';
comment on column public.total_loss_case_details.report_upload_phase is
  'Internal crash-recovery phase for replacing the canonical report object.';
comment on column public.total_loss_case_details.report_upload_has_backup is
  'Whether the active upload protocol has durably preserved the previously committed canonical report.';
comment on column public.total_loss_case_details.report_last_upload_id is
  'Internal idempotency key for the most recently finalized report upload.';
comment on column public.total_loss_case_details.report_last_cancelled_upload_id is
  'Internal idempotency key for the most recently cancelled report upload.';

create function public.set_total_loss_case_details_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
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
    new.report_original_filename,
    new.report_uploaded_at,
    new.intake_completed_at,
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
    old.report_original_filename,
    old.report_uploaded_at,
    old.intake_completed_at,
    old.report_last_upload_id
  ) then
    new.updated_at := statement_timestamp();
  else
    new.updated_at := old.updated_at;
  end if;

  return new;
end;
$$;

comment on function public.set_total_loss_case_details_updated_at() is
  'Advances the public details version for customer-visible changes and successful finalization, but not for lease-only coordination.';

revoke execute on function public.set_total_loss_case_details_updated_at() from public;
revoke execute on function public.set_total_loss_case_details_updated_at() from anon;
revoke execute on function public.set_total_loss_case_details_updated_at() from authenticated;
revoke execute on function public.set_total_loss_case_details_updated_at() from service_role;

create trigger total_loss_case_details_set_updated_at
before update on public.total_loss_case_details
for each row execute function public.set_total_loss_case_details_updated_at();

alter table public.total_loss_case_details enable row level security;

create policy "Customers can read their own total-loss details"
on public.total_loss_case_details
for select
to authenticated
using (
  exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = total_loss_case_details.case_id
      and appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'total_loss'
  )
);

comment on policy "Customers can read their own total-loss details" on public.total_loss_case_details is
  'A customer can read details only through an owned parent whose service type is total_loss.';

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
  )
);

comment on policy "Customers can create their own total-loss details" on public.total_loss_case_details is
  'A customer can attach details only to an owned total-loss parent case.';

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
  )
)
with check (
  exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id = total_loss_case_details.case_id
      and appraisal_case.user_id = (select auth.uid())
      and appraisal_case.service_type = 'total_loss'
  )
);

comment on policy "Customers can update their own total-loss details" on public.total_loss_case_details is
  'Ownership and total-loss service type are checked before and after an update; column grants keep identifiers and timestamps server-controlled.';

revoke all on table public.total_loss_case_details from public;
revoke all on table public.total_loss_case_details from anon;
revoke all on table public.total_loss_case_details from authenticated;

grant select (
  case_id,
  intake_mode,
  vin,
  vehicle_year,
  vehicle_make,
  vehicle_model,
  vehicle_trim,
  mileage_at_loss,
  postal_code,
  date_of_loss,
  insurer_name,
  insurer_vehicle_valuation,
  report_original_filename,
  report_uploaded_at,
  intake_completed_at,
  created_at,
  updated_at
) on public.total_loss_case_details to authenticated;
grant insert (
  case_id,
  intake_mode,
  vin,
  vehicle_year,
  vehicle_make,
  vehicle_model,
  vehicle_trim,
  mileage_at_loss,
  postal_code,
  date_of_loss,
  insurer_name,
  insurer_vehicle_valuation,
  intake_completed_at
) on public.total_loss_case_details to authenticated;
grant update (
  intake_mode,
  vin,
  vehicle_year,
  vehicle_make,
  vehicle_model,
  vehicle_trim,
  mileage_at_loss,
  postal_code,
  date_of_loss,
  insurer_name,
  insurer_vehicle_valuation,
  intake_completed_at
) on public.total_loss_case_details to authenticated;
grant select, insert, update, delete on table public.total_loss_case_details to service_role;

revoke all on type public.total_loss_intake_mode from public;
revoke all on type public.total_loss_intake_mode from anon;
grant usage on type public.total_loss_intake_mode to authenticated, service_role;

-- A browser reserves this identifier before authentication redirects so a lost
-- insert response can be recovered by fetching the same owned draft. RLS still
-- requires user_id to equal auth.uid(), while status continues to use its
-- database default and remains browser-read-only.
grant insert (id) on table public.appraisal_cases to authenticated;

create type public.total_loss_report_upload_lease as (
  upload_id uuid,
  expires_at timestamptz,
  details_updated_at timestamptz,
  report_original_filename text,
  report_uploaded_at timestamptz,
  recovery_required boolean
);

comment on type public.total_loss_report_upload_lease is
  'Short-lived coordination state returned to the browser for one private total-loss report upload.';

revoke all on type public.total_loss_report_upload_lease from public;
revoke all on type public.total_loss_report_upload_lease from anon;
grant usage on type public.total_loss_report_upload_lease to authenticated, service_role;

create type public.total_loss_case_details_public as (
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
  report_original_filename text,
  report_uploaded_at timestamptz,
  intake_completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
);

comment on type public.total_loss_case_details_public is
  'Customer-visible total-loss details returned by restricted report-upload RPCs.';

revoke all on type public.total_loss_case_details_public from public;
revoke all on type public.total_loss_case_details_public from anon;
grant usage on type public.total_loss_case_details_public to authenticated, service_role;

create function public.acquire_total_loss_report_upload(
  case_id uuid,
  expected_updated_at timestamptz,
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
  recovery_required boolean := false;
  details_found boolean := false;
begin
  if authenticated_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to acquire a report-upload lease.';
  end if;

  if $3 is null then
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
  details_found := found;

  if details_found and details_row.report_upload_id = $3 then
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
      details_row.report_upload_phase = 'recovering';
    return;
  end if;

  if $2 is null and details_found then
    raise exception using
      errcode = '40001',
      message = 'Total-loss details already exist for this case.';
  end if;

  if $2 is not null and (
    not details_found
    or details_row.updated_at is distinct from $2
  ) then
    raise exception using
      errcode = '40001',
      message = 'The total-loss details changed before the report upload began.';
  end if;

  if not details_found then
    insert into public.total_loss_case_details (
      case_id,
      intake_mode,
      report_upload_id,
      report_upload_expires_at,
      report_upload_details_updated_at,
      report_upload_phase
    )
    values (
      $1,
      'report',
      $3,
      statement_timestamp() + interval '30 minutes',
      statement_timestamp(),
      'preparing'
    )
    returning * into details_row;

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

  if details_row.report_upload_id is not null
    and details_row.report_upload_expires_at > statement_timestamp() then
    raise exception using
      errcode = '55P03',
      message = 'Another report upload is already active for this case.';
  end if;

  recovery_required :=
    details_row.report_upload_id is not null
    and details_row.report_upload_phase in ('ready', 'recovering')
    and details_row.report_upload_has_backup;

  update public.total_loss_case_details as details
  set
    report_upload_id = $3,
    report_upload_expires_at = statement_timestamp() + interval '30 minutes',
    report_upload_details_updated_at = details_row.updated_at,
    report_upload_phase = case
      when recovery_required then 'recovering'
      else 'preparing'
    end,
    report_upload_has_backup = recovery_required
  where details.case_id = $1
  returning details.* into details_row;

  return query
  select
    details_row.report_upload_id,
    details_row.report_upload_expires_at,
    details_row.report_upload_details_updated_at,
    details_row.report_original_filename,
    details_row.report_uploaded_at,
    recovery_required;
end;
$$;

comment on function public.acquire_total_loss_report_upload(uuid, timestamptz, uuid) is
  'Idempotently acquires one owned draft-case upload lease with a caller-reserved attempt ID, or takes over an expired lease in an explicit recovery phase.';

create function public.renew_total_loss_report_upload(
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
begin
  if authenticated_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to renew a report-upload lease.';
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
    details_row.report_upload_phase = 'recovering';
end;
$$;

comment on function public.renew_total_loss_report_upload(uuid, uuid) is
  'Renews only the exact active report-upload token without changing the customer-visible details version.';

create function public.mark_total_loss_report_upload_ready(
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
    backup_path := authenticated_user_id::text || '/' || $1::text
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
  'Moves a preparing upload to ready only after any required deterministic backup is present with the active token.';

create function public.complete_total_loss_report_upload_recovery(
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

  canonical_path := authenticated_user_id::text || '/' || $1::text
    || '/valuation-report.pdf';
  backup_path := authenticated_user_id::text || '/' || $1::text
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
  'Confirms token-matched restoration of the prior canonical report before permitting another replacement attempt.';

create function public.finalize_total_loss_report_upload(
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

  canonical_path := authenticated_user_id::text || '/' || $1::text
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
    report_upload_has_backup = false
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
  'Atomically commits report metadata, releases the exact upload lease, and touches the owned parent draft; retries of the committed token are idempotent.';

create function public.cancel_total_loss_report_upload(
  case_id uuid,
  upload_id uuid
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
begin
  if authenticated_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to cancel a report upload.';
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
    and details_row.report_last_cancelled_upload_id = $2 then
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

  if details_row.report_upload_id is distinct from $2 then
    raise exception using
      errcode = '55000',
      message = 'The report-upload lease is no longer active.';
  end if;

  if details_row.report_upload_phase <> 'preparing'
    and not (
      details_row.report_upload_phase = 'ready'
      and not details_row.report_upload_has_backup
      and details_row.report_original_filename is null
      and details_row.report_uploaded_at is null
    ) then
    raise exception using
      errcode = '55000',
      message = 'Recover the prior report before cancelling this upload.';
  end if;

  update public.total_loss_case_details as details
  set
    report_last_cancelled_upload_id = $2,
    report_upload_id = null,
    report_upload_expires_at = null,
    report_upload_details_updated_at = null,
    report_upload_phase = null,
    report_upload_has_backup = false
  where details.case_id = $1
  returning details.* into details_row;

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

comment on function public.cancel_total_loss_report_upload(uuid, uuid) is
  'Idempotently releases an upload token only when no committed report needs restoration.';

create function public.authorize_total_loss_report_storage_write(
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
          $1 = appraisal_case.user_id::text || '/' || details.case_id::text
            || '/valuation-report.pdf'
          and details.report_upload_phase in ('ready', 'recovering')
        )
        or (
          $1 = appraisal_case.user_id::text || '/' || details.case_id::text
            || '/valuation-report-backup.pdf'
          and details.report_upload_phase in ('preparing', 'recovering')
        )
      )
  );
$$;

comment on function public.authorize_total_loss_report_storage_write(text, jsonb) is
  'Restricts the two reserved private report objects to the exact unexpired upload token and protocol phase.';

create function public.authorize_total_loss_report_backup_delete(
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
      and details.report_upload_id is null
      and $1 = appraisal_case.user_id::text || '/' || details.case_id::text
        || '/valuation-report-backup.pdf'
      and $2 ->> 'uploadId' in (
        details.report_last_upload_id::text,
        details.report_last_cancelled_upload_id::text
      )
  );
$$;

comment on function public.authorize_total_loss_report_backup_delete(text, jsonb) is
  'Permits cleanup of the single backup only after its token finalized or cancelled and before any newer lease starts.';

revoke execute on function public.acquire_total_loss_report_upload(uuid, timestamptz, uuid) from public;
revoke execute on function public.renew_total_loss_report_upload(uuid, uuid) from public;
revoke execute on function public.mark_total_loss_report_upload_ready(uuid, uuid, boolean) from public;
revoke execute on function public.complete_total_loss_report_upload_recovery(uuid, uuid) from public;
revoke execute on function public.finalize_total_loss_report_upload(uuid, uuid, text, timestamptz) from public;
revoke execute on function public.cancel_total_loss_report_upload(uuid, uuid) from public;
revoke execute on function public.authorize_total_loss_report_storage_write(text, jsonb) from public;
revoke execute on function public.authorize_total_loss_report_backup_delete(text, jsonb) from public;

revoke execute on function public.acquire_total_loss_report_upload(uuid, timestamptz, uuid) from anon;
revoke execute on function public.renew_total_loss_report_upload(uuid, uuid) from anon;
revoke execute on function public.mark_total_loss_report_upload_ready(uuid, uuid, boolean) from anon;
revoke execute on function public.complete_total_loss_report_upload_recovery(uuid, uuid) from anon;
revoke execute on function public.finalize_total_loss_report_upload(uuid, uuid, text, timestamptz) from anon;
revoke execute on function public.cancel_total_loss_report_upload(uuid, uuid) from anon;
revoke execute on function public.authorize_total_loss_report_storage_write(text, jsonb) from anon;
revoke execute on function public.authorize_total_loss_report_backup_delete(text, jsonb) from anon;

grant execute on function public.acquire_total_loss_report_upload(uuid, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.renew_total_loss_report_upload(uuid, uuid) to authenticated, service_role;
grant execute on function public.mark_total_loss_report_upload_ready(uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.complete_total_loss_report_upload_recovery(uuid, uuid) to authenticated, service_role;
grant execute on function public.finalize_total_loss_report_upload(uuid, uuid, text, timestamptz) to authenticated, service_role;
grant execute on function public.cancel_total_loss_report_upload(uuid, uuid) to authenticated, service_role;
grant execute on function public.authorize_total_loss_report_storage_write(text, jsonb) to authenticated, service_role;
grant execute on function public.authorize_total_loss_report_backup_delete(text, jsonb) to authenticated, service_role;

drop policy if exists "Customers can add files for their own cases" on storage.objects;
drop policy if exists "Customers can update files for their own cases" on storage.objects;
drop policy if exists "Customers can delete files for their own cases" on storage.objects;

create policy "Customers can add files for their own cases"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'case-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id::text = lower((storage.foldername(name))[2])
      and appraisal_case.user_id = (select auth.uid())
  )
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
);

comment on policy "Customers can add files for their own cases" on storage.objects is
  'Preserves owned case-file inserts while requiring a live protocol token for the two reserved total-loss report objects.';

create policy "Customers can update files for their own cases"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'case-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id::text = lower((storage.foldername(name))[2])
      and appraisal_case.user_id = (select auth.uid())
  )
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
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id::text = lower((storage.foldername(name))[2])
      and appraisal_case.user_id = (select auth.uid())
  )
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

comment on policy "Customers can update files for their own cases" on storage.objects is
  'Checks ownership for every case-file update and permits reserved report paths only during token-bound upload replacement, never move or rename operations.';

create policy "Customers can delete files for their own cases"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'case-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.appraisal_cases as appraisal_case
    where appraisal_case.id::text = lower((storage.foldername(name))[2])
      and appraisal_case.user_id = (select auth.uid())
  )
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
      and public.authorize_total_loss_report_backup_delete(name, user_metadata)
    )
  )
);

comment on policy "Customers can delete files for their own cases" on storage.objects is
  'Preserves owned case-file deletion, denies canonical report deletion, and prevents stale tabs from deleting a newer report backup.';
